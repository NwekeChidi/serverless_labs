import { Context } from "aws-lambda";

export const handler = async (event: any, _ctx: Context) => {
  const text: string = String(event.text ?? "");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const ents = [...text.matchAll(/\b[A-Z][a-zA-Z]+\b/g)].map((m) => ({ type: "CapWord", text: m[0] }));
  return { docId: event.docId, entities: ents, ts: new Date().toISOString() };
};
