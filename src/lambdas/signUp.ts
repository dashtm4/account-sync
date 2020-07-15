import AWS from 'aws-sdk';
import middy from 'middy';
import { jsonBodyParser } from 'middy/middlewares';
import Boom from '@hapi/boom';
import { APIGatewayEvent, SignUpEvent } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

interface SignUpResponse {
    message: string;
}

const rawHandler = async (event: APIGatewayEvent<SignUpEvent>)
: Promise<APIGatewayResponse<SignUpResponse>> => {
    // eslint-disable-next-line no-console
    console.log(event);
    if (!event.body) return Boom.badData('Body was not provided');

    try {
        const { Item } = await dynamoDb.get({
            TableName: process.env.tableName!,
            Key: { Email: event.body.email },
        }).promise();
        if (Item) return Boom.notAcceptable('User already exists');
    } catch (e) {
        return Boom.badData(e);
    }

    const params = {
        TableName: process.env.tableName!,
        Item: {
            Email: event.body.email,
            CognitoId: event.body.cognitoId,
        },
    };
    try {
        await dynamoDb.put(params).promise();
    } catch (e) {
        Boom.internal('Error during insert');
    }

    return { message: 'Successfully signed new user' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<SignUpEvent>, APIGatewayResponse<SignUpResponse>>());
