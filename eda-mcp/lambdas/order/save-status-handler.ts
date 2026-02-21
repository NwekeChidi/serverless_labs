import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Context } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE = process.env.ORDERS_TABLE!;

export const handler = async (event: any, _ctx: Context) => {
  const orderId = String(event.orderId ?? "unknown");
  const status = String(event.status ?? "UNKNOWN");

  await ddb.send(
    new PutCommand({
      TableName: ORDERS_TABLE,
      Item: {
        orderId,
        status,
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  return { orderId, status };
};
