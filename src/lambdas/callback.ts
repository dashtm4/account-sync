import middy from 'middy';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, GetReportEvent, SuccessReportStoreResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const rawHandler = async (
    event: APIGatewayEvent<GetReportEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {
    console.log('> callback body', event.body);
    console.log('> callback event.pathParameters', event.pathParameters);

    return { message: 'Report successfully stored in db', id: '' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<GetReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());
