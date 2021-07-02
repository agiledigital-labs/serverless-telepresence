const JSZip = require("jszip");
const HttpServer = require("./server");

const zippedCode = (ngrokUrl) => {
  const ngrokDomain = ngrokUrl.replace(/.*\//, "");
  const code = `"use strict";

  module.exports.hello = (event, context, callback) => {
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
  zip.file("handler.js", code);
  return bufferFromStream(
    zip.generateNodeStream({ type: "nodebuffer", streamFiles: true })
  );
};

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
      ZipFile: await zippedCode(ngrokUrl),
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
