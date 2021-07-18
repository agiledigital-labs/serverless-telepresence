const JSZip = require("jszip");
const HttpServer = require("./server");

const zippedCode = (handler, method, ngrokUrl) => {
  const ngrokDomain = ngrokUrl.replace(/.*\//, "");
  const code = `"use strict";

  module.exports.${method} = (event, context, callback) => {
    console.log(JSON.stringify({ event, context }));
    const https = require("https");

    const data = JSON.stringify({ event, context });

    const options = {
      hostname: "${ngrokDomain}",
      port: 443,
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      },
    };

    const req = https.request(options, (res) => {
      console.log(\`statusCode: \${res.statusCode}\`);

      res.on("data", (d) => {
        console.log("Response was: " + d.toString());
        callback(null, {
          statusCode: 200,
          body: d.toString(),
        });
      });
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.write(data);
    req.end();
  };`;

  const bufferFromStream = async (stream) => {
    return new Promise((resolve, reject) => {
      const _buf = [];

      stream.on("data", (chunk) => _buf.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(_buf)));
      stream.on("error", (err) => reject(err));
    });
  };

  const zip = new JSZip();
  zip.file(handler, code);
  return bufferFromStream(
    zip.generateNodeStream({ type: "nodebuffer", streamFiles: true })
  );
};

const assumRolePolicy = (lambdaRoleName, userArn) => ({
  RoleName: lambdaRoleName,
  PolicyDocument: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com",
        },
        Action: "sts:AssumeRole",
      },
      {
        Effect: "Allow",
        Principal: {
          AWS: userArn,
        },
        Action: "sts:AssumeRole",
      },
    ],
  }),
});

module.exports = class ServerlessTelepresence {
  constructor(serverless, options) {
    this.options = options;
    this.serverless = serverless;
    this.provider = this.serverless.getProvider("aws");
    this.commands = {
      proxy: {
        usage: "Proxy your function Lambda locally",
        lifecycleEvents: ["start"],
        options: {
          function: {
            usage: "specify the function you want to proxy",
            required: true,
            shortcut: "f",
          },
        },
      },
    };
    this.hooks = {
      "proxy:start": this.start.bind(this),
    };
  }

  async start() {
    const { stage, region } = this.serverless.service.provider;
    const lambdaRoleName = `${this.serverless.service.serviceObject.name}-${stage}-${region}-lambdaRole`;
    const userArn = (await this.provider.request("IAM", "getUser", {})).User
      .Arn;
    const policy = assumRolePolicy(lambdaRoleName, userArn);
    await this.provider.request("IAM", "updateAssumeRolePolicy", policy);

    const accountId = userArn.replace(/\D/g, "");
    const roleCommand = {
      RoleArn: `arn:aws:iam::${accountId}:role/${lambdaRoleName}`,
      RoleSessionName: `proxy-session`,
    };
    const assumedRole = await this.provider.request(
      "STS",
      "assumeRole",
      roleCommand
    );
    process.env.AWS_ACCESS_KEY_ID = assumedRole.Credentials.AccessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = assumedRole.Credentials.SecretAccessKey;
    process.env.AWS_SESSION_TOKEN = assumedRole.Credentials.SessionToken;
    console.log("Assumed lambda execution role for the function.");

    const servicePath = this.serverless.config.servicePath;
    const functionObject = this.serverless.service.getFunction(
      this.options.function
    );
    const [path, method] = functionObject.handler.split(".");
    const server = new HttpServer(`${servicePath}/${path}.js`, method, {});
    const ngrokUrl = await server.start();
    console.log(`ngrok url [${ngrokUrl}].`);
    await this.provider.request("Lambda", "updateFunctionCode", {
      FunctionName: functionObject.name,
      ZipFile: await zippedCode(`${path}.js`, method, ngrokUrl),
    });
    this.serverless.cli.log(
      `Deployed proxy for function: ${functionObject.name}`
    );
    process.once("SIGINT", async (code) => {
      console.log("SIGINT received...");
      await this.serverless.pluginManager.spawn("deploy");
      process.exit();
    });
  }
};
