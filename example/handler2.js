const { DynamoDBClient, ListTablesCommand } = require(
  "@aws-sdk/client-dynamodb",
);

const listDynamoDBTables = async () => {
  const client = new DynamoDBClient({ region: "ap-southeast-2" });
  const command = new ListTablesCommand({});
  const results = await client.send(command);
  console.log(results.TableNames.join("\n"), "test");
};

module.exports.dyno = async (event, context) => {
  console.log("asdf");
  try {
    const tables = await listDynamoDBTables();
    console.log(tables);
    const response = {
      statusCode: 200,
      body: JSON.stringify({ message: `Table count ${tables}` }),
      tables,
    };
    return response;
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      error: err,
    };
  }
};
