const { ServiceException } = require("@aws-sdk/smithy-client");

module.exports.handler = async (event, context) => {
    throw new ServiceException({
        name: "Lambda.ServiceException",
        message: "This is a Simulation of ServiceException error",
        $fault: "client" })
}