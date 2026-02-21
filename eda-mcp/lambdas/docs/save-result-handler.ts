import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Context } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DOC_RESULTS_TABLE = process.env.DOC_RESULTS_TABLE!;

export const handler = async (event: any, _ctx: Context) => {
  const docId = String(event.docId ?? "unknown");
  await ddb.send(
    new PutCommand({
      TableName: DOC_RESULTS_TABLE,
      Item: {
        docId,
        result: event,
        savedAt: new Date().toISOString(),
      },
    }),
  );
  return { docId, saved: true };
};
