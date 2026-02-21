#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EdaMcpStack } from "../lib/eda-mcp-stack";

const app = new cdk.App();
new EdaMcpStack(app, "EdaMcpStack", {
  demoName: "workflow-demos",
  stateMachinePrefix: "demo-",
});
