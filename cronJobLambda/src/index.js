module.exports.handler = async (event) => {
  console.log(`Lambda function triggered by EventBridge Scheduler on: ${new Date()}`);

  try {
    const response = await downstreamProcess();
    console.log(`Downstream process completed with response: ${response}`);
  } catch (error) {
    console.log(`An Error Occurred 😕: ${error}`);
    throw new Error("LambdaException");
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Task Completed!🎉",
    }),
  };
};

const downstreamProcess = async () => {
  // Function to simulate a downstream process
  return `A New Hope on ${new Date()}!`;
};
