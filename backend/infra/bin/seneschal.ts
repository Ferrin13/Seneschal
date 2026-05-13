#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SeneschalStack } from "../lib/seneschal-stack";

const app = new cdk.App();

new SeneschalStack(app, "SeneschalDev", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  envName: "dev",
  firebaseProjectId:
    process.env.FIREBASE_PROJECT_ID ?? "seneschal-dev",
});
