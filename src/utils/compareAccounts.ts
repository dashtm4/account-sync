import { Account } from '../types/reports';

export const compareAccounts = (
    dbAccounts: AWS.DynamoDB.DocumentClient.ItemList,
    newAccounts: Account[],
) => {
    dbAccounts.forEach((account) => {
        newAccounts.forEach((newAccount) => {
            if (account.AccountName === newAccount.AccountName) {
                // eslint-disable-next-line no-param-reassign
                account.ValueCents = newAccount.ValueCents;
            }
        });
    });

    return dbAccounts;
};
