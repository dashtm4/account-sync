/* eslint-disable no-extend-native */
if (!String.prototype.withIndent) {
    // eslint-disable-next-line func-names
    String.prototype.withIndent = function (): String {
        return this + new Array(20 - this.length).join(' ');
    };
}

const flipSign = (toggle: string | undefined, value: number) => {
    if (toggle && toggle.includes('Y')) {
        return Math.round(-value);
    }

    return Math.round(value);
};

const processUltraTax = (accounts: AWS.DynamoDB.DocumentClient.ItemList) => {
    const data = [];

    // eslint-disable-next-line no-restricted-syntax
    
    for (const account of accounts) {
        if (account.TaxCode){
            const taxCode = account.TaxCode;
            const acctNum = account.AcctNum ? account.AcctNum : '';
            const value = account.ValueCents ? flipSign(account.Toggle, account.ValueCents) : '';
            const name = account.AccountName;
            data.push(`${taxCode.withIndent()}${acctNum.withIndent()}${value.toString().withIndent()}${name.toString().withIndent()}`);
        }
    }

    return data;
};

export const processReport = (
    accounts: AWS.DynamoDB.DocumentClient.ItemList, software: string,
) => {
    switch (software) {
        case 'UltraTax':
            return processUltraTax(accounts);
        default:
            return [];
    }
};
