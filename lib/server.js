const express = require("express");
const bodyParser = require("body-parser");
const ngrok = require("ngrok");
const { exec } = require("child_process");
// const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
// const {
//   IAMClient,
//   UpdateAssumeRolePolicyCommand,
// } = require("@aws-sdk/client-iam");
const app = express();
const port = process.env.PORT || 8080;
app.use(bodyParser.json());
const shellCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      return resolve(stdout);
    });
  });
const invokeFunction = async ({
  functionPath,
  functionMethod,
  event,
  context,
}) => {
  delete require.cache[require.resolve(functionPath)];
  const func = require(functionPath)[functionMethod];
  const result = await func(event, context);
  return result;
};

class TelepresenceHttpServer {
  constructor(functionPath, functionMethod, serverless) {
    this.functionPath = functionPath;
    this.functionMethod = functionMethod;
    // ??? Not sure where are those values.
    // this.serviceName = serverless.service.name;
    // this.region = serverless.provider.region;
    // this.stage = serverless.stage;
    // this.accountId = serverless.accountId;
  }
  async start() {
    app.get("/", (_, res) => {
      res.json({
        status: "running",
      });
    });
    app.post("/", async (req, res) => {
      const event = req.body.event;
      const context = req.body.context;
      // TODO: remove 'cd example'
      // const stdOut = await shellCommand(
      //   `cd example && npx sls invoke local --function ${this.functionName} -d '${JSON.stringify(event)}' --context '${JSON.stringify(context)}'`
      // );
      // const stsClient = new STSClient({ region: this.region });
      // const iamClient = new IAMClient({ region: this.region });
      // const lambdaRoleName = `${this.serviceName}-${this.stage}-${this.region}-lambdaRole`;
      // const updateAssumeRolePolicyCommand =
      // // TODO: the Trust relationship is configured manually to the lambda role: the current AWS user that deploys serverless project and the lambda role.
      // // TODO: we need to find a way to allow current deployment role to assume the lambda role.
      // const assumeRoleCommand = new AssumeRoleCommand({
      //   RoleArn: `arn:aws:iam::${this.accountId}:role/${lambdaRoleName}`,
      //   RoleSessionName: `assumed-${lambdaRoleName}`
      // });
      // const assumedRole = await stsClient.send(assumeRoleCommand);
      // process.env.AWS_ACCESS_KEY_ID = assumedRole.Credentials.AccessKeyId;
      // process.env.AWS_SECRET_ACCESS_KEY = assumedRole.Credentials.SecretAccessKey;
      // process.env.AWS_SESSION_TOKEN = assumedRole.Credentials.SessionToken;
      const result = await invokeFunction({
        functionPath: this.functionPath,
        functionMethod: this.functionMethod,
        event,
        context,
      });
      res.send(JSON.stringify(result));
    });

    const connect = () =>
      new Promise(async (resolve) => {
        app.listen(port, async () => {
          const ngrokUrl = await ngrok.connect(port);
          console.log(
            `Local server started at [http://localhost:${port}] for function [${this.functionName}], available externally on [${ngrokUrl}].`,
          );
          resolve(ngrokUrl);
        });
      });
    return connect();
  }
}

module.exports = TelepresenceHttpServer;
