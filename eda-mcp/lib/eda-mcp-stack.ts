import { Stack, StackProps, Duration, Tags, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { Table, BillingMode, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";
import { Construct } from "constructs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { LambdaInvoke, SqsSendMessage } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { StateMachine, TaskInput, Choice, Condition, JsonPath, StateMachineType, Pass } from "aws-cdk-lib/aws-stepfunctions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { CfnRegistry, CfnSchema } from "aws-cdk-lib/aws-eventschemas";
import { Rule, RuleTargetInput } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";

interface Props extends StackProps {
  demoName?: string;
  stateMachinePrefix?: string;
}
export class EdaMcpStack extends Stack {
  constructor(scope: Construct, id: string, props?: Props) {
    super(scope, id, props);

    const demoName = props?.demoName;
    const sfPrefix = props?.stateMachinePrefix;

    const ordersTableName = `${demoName}-orders`;
    const docResultsTableName = `${demoName}-doc-results`;

    //// SQS
    const shippingQueue = new Queue(this, "ShippingQueue", {
      queueName: `${demoName}-shipping-queue`,
    });

    //// DynamoDB
    // orders table
    const OrdersTable = new Table(this, ordersTableName, {
      tableName: ordersTableName,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "orderId",
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // doc results table
    const DocResultsTable = new Table(this, docResultsTableName, {
      tableName: docResultsTableName,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Helper to create Lambdas
    const nodeFn = (id: string, entryRel: string, env?: Record<string, string>) =>
      new NodejsFunction(this, id, {
        entry: path.join(__dirname, "..", "lambdas", entryRel),
        handler: "handler",
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        bundling: {
          target: "node20",
          format: OutputFormat.ESM,
          minify: true,
          sourceMap: false,
        },
        memorySize: 128,
        timeout: Duration.seconds(10),
        environment: env,
      });

    // Order Lambdas
    const chargePaymentHandler = nodeFn("ChargePaymentHandler", "order/charge-payment-handler.ts");
    const checkInventoryHandler = nodeFn("CheckInventoryHandler", "order/check-inventory-handler.ts");
    const saveStatusHandler = nodeFn("SaveStatusHandler", "order/save-status-handler.ts", {
      ORDERS_TABLE: OrdersTable.tableName,
    });
    OrdersTable.grantWriteData(saveStatusHandler);

    // Document Lambdas
    const ocrHandler = nodeFn("OcrHandler", "docs/ocr-handler.ts");
    const nlpHandler = nodeFn("NlpHandler", "docs/nlp-handler.ts");
    const saveResultHandler = nodeFn("SaveResult", "docs/save-result-handler.ts", {
      DOC_RESULTS_TABLE: DocResultsTable.tableName,
    });
    DocResultsTable.grantWriteData(saveResultHandler);

    //// State Machines
    // Order Fulfilment
    const chargePayment = new LambdaInvoke(this, "ChargePayment", {
      lambdaFunction: chargePaymentHandler,
      payloadResponseOnly: true,
    }).addRetry({ maxAttempts: 3, interval: Duration.seconds(5), backoffRate: 2 });

    const checkInvetory = new LambdaInvoke(this, "CheckInventory", {
      lambdaFunction: checkInventoryHandler,
      payloadResponseOnly: true,
    });

    const requestShipment = new SqsSendMessage(this, "RequestShipment", {
      queue: shippingQueue,
      messageBody: TaskInput.fromJsonPathAt("$"),
      resultPath: JsonPath.DISCARD,
    });

    const markShipped = new LambdaInvoke(this, "MarkShipped", {
      lambdaFunction: saveStatusHandler,
      payload: TaskInput.fromObject({
        "orderId.$": "$.orderId",
        status: "SHIPPED",
      }),
      payloadResponseOnly: true,
    });

    const outOfStock = new LambdaInvoke(this, "OutOfStock", {
      lambdaFunction: saveStatusHandler,
      payload: TaskInput.fromObject({
        "orderId.$": "$.orderId",
        status: "OUT_OF_STOCK",
      }),
      payloadResponseOnly: true,
    });

    const paymentFailed = new LambdaInvoke(this, "PaymentFailed", {
      lambdaFunction: saveStatusHandler,
      payload: TaskInput.fromObject({
        "orderId.$": "$.orderId",
        status: "PAYMENT_FAILED",
      }),
      payloadResponseOnly: true,
    });

    const inStockChoice = new Choice(this, "InStockChoice")
      .when(Condition.booleanEquals("$.inStock", true), requestShipment.next(markShipped))
      .otherwise(outOfStock);

    chargePayment.addCatch(paymentFailed, { resultPath: JsonPath.DISCARD });

    const orderDefinition = chargePayment.next(checkInvetory).next(inStockChoice);

    const orderSm = new StateMachine(this, "OrderFulfillmentSM", {
      stateMachineName: `${sfPrefix}order-fulfilment`,
      definition: orderDefinition,
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
      comment: "Order fulfillment (Express): charge, check inventory, ship or mark out-of-stock",
    });

    // Permissions for SM -> Lambda/SQS
    chargePaymentHandler.grantInvoke(orderSm);
    checkInventoryHandler.grantInvoke(orderSm);
    saveStatusHandler.grantInvoke(orderSm);
    shippingQueue.grantSendMessages(orderSm);

    // Document Processing SM (EXPRESS)
    const normalize = new Pass(this, "Normalize", {
      parameters: {
        "bucket.$": "$.bucket.name",
        "key.$": "$.object.key",
        "docId.$": "$.object.key",
      },
    });

    const ocrTask = new LambdaInvoke(this, "OCR", {
      lambdaFunction: ocrHandler,
      payloadResponseOnly: true,
    });

    const nlpTask = new LambdaInvoke(this, "NLP", {
      lambdaFunction: nlpHandler,
      payloadResponseOnly: true,
    });

    const saveTask = new LambdaInvoke(this, "Save", {
      lambdaFunction: saveResultHandler,
      payloadResponseOnly: true,
    });

    const docDefinition = normalize.next(ocrTask).next(nlpTask).next(saveTask);

    const docSm = new StateMachine(this, "DocProcessingSM", {
      stateMachineName: `${sfPrefix}doc-processing`,
      definition: docDefinition,
      stateMachineType: StateMachineType.EXPRESS,
      tracingEnabled: true,
      comment: "Process an S3 document: OCR -> NLP -> Save result",
    });

    ocrHandler.grantInvoke(docSm);
    nlpHandler.grantInvoke(docSm);
    saveResultHandler.grantInvoke(docSm);

    //// EventBridge Schemas (for MCP docs)
    const registry = new CfnRegistry(this, "DocSchemaRegistry", {
      registryName: `${demoName}-inputs`,
      description: "Input schemas for Step Functions demos",
    });

    const orderSchema = new CfnSchema(this, "OrderFulfillmentInputSchema", {
      registryName: registry.registryName!,
      schemaName: "OrderFulfillmentInput",
      type: "OpenApi3",
      description: "Input schema for the Order Fulfilment demo",
      content: JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "order-fulfilment-input",
          version: "1.0.0",
        },
        paths: {},
        components: {
          schemas: {
            OrderFulfillmentInput: {
              type: "object",
              properties: {
                orderId: {
                  type: "string",
                },
                sku: {
                  type: "string",
                },
                qty: {
                  type: "integer",
                },
                amount: {
                  type: "number",
                },
              },
              required: ["orderId", "sku", "qty", "amount"],
            },
          },
        },
      }),
    });
    orderSchema.addDependency(registry);

    const docSchema = new CfnSchema(this, "DocProcessingInputSchema", {
      registryName: registry.registryName!,
      schemaName: "DocProcessingInput",
      type: "OpenApi3",
      description: "Input schema for the Document Processing demo",
      content: JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "doc-processing-input",
          version: "1.0.0",
        },
        paths: {},
        components: {
          schemas: {
            DocProcessingInput: {
              type: "object",
              properties: {
                bucket: {
                  type: "string",
                },
                key: {
                  type: "string",
                },
              },
              required: ["bucket", "key"],
            },
          },
        },
      }),
    });
    docSchema.addDependency(registry);

    // Tag SMs so MCP server can surface input docs
    Tags.of(docSm).add("InputSchemaArm", docSchema.attrSchemaArn);

    // Tag SMs so MCP server can surface input docs
    Tags.of(orderSm).add("InputSchemaArm", orderSchema.attrSchemaArn);

    // EventBridge Rules
    const orderRule = new Rule(this, "OrderPlacedRule", {
      eventPattern: { source: ["ecommerce.demo"], detailType: ["OrderPlaced"] },
    });
    orderRule.addTarget(
      new SfnStateMachine(orderSm, {
        input: RuleTargetInput.fromEventPath("$.detail"),
      }),
    );

    const s3Rule = new Rule(this, "S3PutObjectRule", {
      eventPattern: { source: ["aws.s3"], detailType: ["Object Created"] },
    });
    s3Rule.addTarget(
      new SfnStateMachine(docSm, {
        input: RuleTargetInput.fromEventPath("$.detail"),
      }),
    );

    //// Outputs
    new CfnOutput(this, "OrderStateMachineArn", { value: orderSm.stateMachineArn });
    new CfnOutput(this, "DocStateMachineArn", { value: docSm.stateMachineArn });
    new CfnOutput(this, "ShippingQueueUrl", { value: shippingQueue.queueUrl });
    new CfnOutput(this, "OrdersTableName", { value: OrdersTable.tableName });
    new CfnOutput(this, "DocResultsTableName", { value: DocResultsTable.tableName });
  }
}
