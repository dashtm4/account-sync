import AWS from 'aws-sdk';
import middy from 'middy';
import Boom from '@hapi/boom';
import { APIGatewayEvent, DownloadLinkResponse } from '../types/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { APIGatewayResponse } from '../utils/aws';
import { processReport } from '../utils/processReport';
import moment from 'moment';

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const bucketName = process.env.reportBucket!;

const rawHandler = async (
    event: APIGatewayEvent<null>,
): Promise<APIGatewayResponse<DownloadLinkResponse>> => {
    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    const reportId = event.pathParameters.id;

    const { Items: users } = await dynamoDb.scan({
        TableName: process.env.usersTable!,
        FilterExpression: 'CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':cognitoId': cognitoId,
        },
    }).promise();

    const { Item: report } = await dynamoDb.get({
        TableName: process.env.reportsTable!,
        Key: { Id: reportId },
    }).promise();

    if (!report || !users) {
        throw Boom.notAcceptable('Report with this Id was not found!');
    }

    if (report.DonwloadUrl) {
        return { message: 'Successfully uploaded to S3', link: report.DownloadUrl };
    }

    const { Item: client } = await dynamoDb.get({
        TableName: process.env.clientsTable!,
        Key: { Id: report.ClientId },
    }).promise();

    if (!client) {
        throw Boom.notAcceptable('Client connected to report was not found');
    }

    const { Items: accounts } = await dynamoDb.scan({
        TableName: process.env.accountsTable!,
        FilterExpression: 'ReportId = :reportId',
        ExpressionAttributeValues: {
            ':reportId': report.Id,
        },
    }).promise();

    const reportYear = report.EndDate.slice(2, 4);
    const entityType = report.EntityType.match(/\((.*)\)/).pop();

    const data = [`${entityType}, ${reportYear}`, `${client.CompanyName}`, '*', 'A,1,'];

    data.push(...processReport(accounts!, report.Software));

    const key = `${client.CompanyName}-${reportYear}-${report.Software}.DWI`;


    const params = {
        Body: data.join('\n'),
        Bucket: `${bucketName}/${users[0].Email}-${client.CompanyName}`,
        Key: key,
    };

    await s3.putObject(params).promise();

    var url = s3.getSignedUrl('getObject', {Bucket: 'bucket', Key: key});

    //const url = encodeURI(`${process.env.bucketLink}/${users[0].Email}-${client.CompanyName}/${key}`);

    await dynamoDb.update({
        TableName: process.env.reportsTable!,
        Key: { Id: report.Id },
        UpdateExpression: 'set #url = :link AND #link_expiration = :link_expiration',
        ExpressionAttributeNames: {
            '#url': 'DownloadUrl',
            '#link_expiration': 'LinkExpiration'
        },
        ExpressionAttributeValues: {
            ':link': url,
            ':link_expiration': moment().add(7, 'd').format('MMMM Do YYYY, h:mm:ss a')
        },
    }).promise();

    return { message: 'Successfully uploaded report', link: url };
};

export const handler = middy(rawHandler)
    .use(apiGatewayResponse<APIGatewayEvent<null>,
    APIGatewayResponse<DownloadLinkResponse>>());
