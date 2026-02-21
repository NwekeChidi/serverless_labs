import { Context } from "aws-lambda";

export const handler = async (event: any, _ctx: Context) => {
  const docId = String(event.docId ?? event.key ?? "unknown");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const text = `Mock OCR text for s3://${event.bucket}/${event.key}`;
  return { docId, text, ts: new Date().toISOString() };
};
