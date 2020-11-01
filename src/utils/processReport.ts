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
    
    //find longest value cents

    var longest = 0
    for (const account of accounts) {
        if (account.ValueCents.length > longest){
            longest = account.valueCents.length;
        }
    }
    for (const account of accounts) {
        if (account.TaxCode){
            console.log("before tax code");
            const taxCode = account.TaxCode.withIndent();
            console.log("before AcctNum");
            console.log(JSON.stringify(account));
            const acctNum = account.AcctNum ? account.AcctNum.toString().withIndent() : account.AccountName.withIndent();
            console.log("afteracctnum");
            const value = account.ValueCents ? flipSign(account.Toggle, account.ValueCents) : '';
            const name = account.AccountName.substring(0, 29);
            data.push(`${taxCode}${acctNum}${new Array(longest + 10 - value.toString().length).join(' ')}${value.toString()}${new Array(10).join(' ')}${name + new Array(100 - name.length).join(' ')}`);
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
