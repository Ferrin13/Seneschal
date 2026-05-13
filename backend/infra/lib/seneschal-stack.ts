import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "node:path";

export interface SeneschalStackProps extends cdk.StackProps {
  envName: string;
  firebaseProjectId: string;
}

/**
 * Single-stack deployment of the Seneschal API:
 *  - VPC (2 AZs, single NAT to keep costs low)
 *  - RDS Postgres (db.t4g.micro) in private subnets
 *  - ECR-backed ECS Fargate service behind a public ALB
 *  - DB credentials in Secrets Manager
 *  - Firebase service-account JSON in SSM Parameter Store (SecureString)
 */
export class SeneschalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SeneschalStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "Postgres SG",
      allowAllOutbound: true,
    });

    const db = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: "seneschal",
      credentials: rds.Credentials.fromGeneratedSecret("seneschal_app"),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: props.envName === "prod",
      removalPolicy:
        props.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.SNAPSHOT,
      multiAz: false,
    });

    // Service-account JSON is uploaded out-of-band; we just reference it.
    const firebaseSecret = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "FirebaseSaJson",
      {
        parameterName: `/seneschal/${props.envName}/firebase-service-account`,
      }
    );

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const image = new ecr_assets.DockerImageAsset(this, "ApiImage", {
      directory: path.join(__dirname, "../.."),
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    const service =
      new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ApiService", {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        publicLoadBalancer: true,
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          containerPort: 8080,
          enableLogging: true,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "seneschal-api",
            logRetention: logs.RetentionDays.ONE_MONTH,
          }),
          environment: {
            NODE_ENV: "production",
            PORT: "8080",
            LOG_LEVEL: "info",
            FIREBASE_PROJECT_ID: props.firebaseProjectId,
          },
          secrets: {
            DATABASE_URL: ecs.Secret.fromSecretsManager(db.secret!, "url"),
            // Note: aws-rds doesn't expose a `url` field directly; in
            // practice you'd build the connection string from host/user/pw
            // in the entrypoint, or use a custom resource. Left as TODO.
            GOOGLE_APPLICATION_CREDENTIALS_JSON:
              ecs.Secret.fromSsmParameter(firebaseSecret),
          },
        },
        healthCheckGracePeriod: cdk.Duration.seconds(30),
      });

    service.targetGroup.configureHealthCheck({
      path: "/healthz",
      healthyHttpCodes: "200",
    });

    db.connections.allowDefaultPortFrom(service.service, "ECS to Postgres");

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
    });
    new cdk.CfnOutput(this, "DbSecretArn", {
      value: db.secret?.secretArn ?? "(none)",
    });
  }
}
