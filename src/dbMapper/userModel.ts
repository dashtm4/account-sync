import {
    DynamoDbSchema,
    DynamoDbTable,
} from '@aws/dynamodb-data-mapper';

export default class UserModel {
    // email: string;
    // cognitoId?:string;
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(public email: string, public cognitoId?: string) {
    }
}

Object.defineProperties(UserModel.prototype, {
    [DynamoDbTable]: {
        value: process.env.userTable,
    },
    [DynamoDbSchema]: {
        value: {
            Email: {
                type: 'String',
                keyType: 'HASH',
            },
            CognitoId: {
                type: 'String',
            },
        },
    },
});
