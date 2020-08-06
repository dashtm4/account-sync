import AWS from 'aws-sdk';
import middy from 'middy';
import { jsonBodyParser } from 'middy/middlewares';
import Boom from '@hapi/boom';
import { APIGatewayEvent, DefaultResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const rawHandler = async (event: APIGatewayEvent<null>)
: Promise<APIGatewayResponse<DefaultResponse>> => {
    // eslint-disable-next-line no-console
    console.log(event);

    const cognito = event.requestContext.authorizer.claims;

    try {
        const { Item } = await dynamoDb.get({
            TableName: process.env.usersTable!,
            Key: { Email: cognito.email },
        }).promise();
        if (Item) {
            throw Boom.notAcceptable('User already exists');
        }
    } catch (e) {
        throw Boom.badData(e);
    }

    const params = {
        TableName: process.env.usersTable!,
        Item: {
            Email: cognito.email,
            CognitoId: cognito.sub,
        },
    };
    try {
        await dynamoDb.put(params).promise();
    } catch (e) {
        throw Boom.internal('Error during insert');
    }

    return { message: 'Successfully signed new user' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<null>, APIGatewayResponse<DefaultResponse>>());
