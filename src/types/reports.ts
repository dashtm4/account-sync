export interface InternalTrialBalanceReport {
    Id: string;
    CreatedAt: string;
    StartPeriod: string;
    EndPeriod: string;
    ReportBasis: string;
    Accounts: Account[];
    Total: {
        DebitCents: number;
        CreditCents: number;
    }
}

export interface QBTrialBalanceReport {
    Header: {
        Time: string;
        ReportName: string;
        ReportBasis: string;
        StartPeriod: string;
        EndPeriod: string;
        Currency: string;
        Option: Option[];
    }
    Columns: {
        Column: Column[];
    };
    Rows: {
        Row: Row[];
    }
}

export interface Row {
    ColData?: ColData[];
    Summary?: {
        ColData: ColData[];
    }
}

export interface ColData {
    value: string;
    id?: string;
}

export interface Column {
    ColTitle: string;
    ColType: string;
}

export interface Option {
    Name: string;
    Value: string;
}

export interface Account {
    AccountName: string;
    ValueCents: number;
    ReportId?: string;
    Id: string;
    QboId: string;
    ParentQboId: string;
    FullyQualifiedName: string;
    Type: string;
    AcctNumAccountNameSortKey?: string;
    Description?: string;
    AcctNum?: string;
    TaxCode?: string;
    TaxCodeDescription?: string;
    Toggle?: string;
    CognitoId?: string;
    EntityType?: string;
}

export interface AccountData {
    Name: string;
    SubAccount: string;
    FullyQualifiedName: string;
    ParentRef:{
        value: string;
    };
    Active: boolean;
    Classification: string;
    AccountType: string;
    Description: string;
    AccountSubType: string;
    CurrentBalance: number;
    CurrentBalanceWithSubAccounts: number;
    CurrencyRef: {
        value: string;
        name: string;
    };
    domain: string;
    sparse: string;
    Id: string;
    SyncToken: string;
    MetaData: {
        CreateTime: string;
        LastUpdatedTime: string;
    };
    AcctNum?: string;
}

export interface AccountInfoResponse {
    QueryResponse: {
        Account: AccountData[];
        startPosition: number;
        maxResults: number;
    };
    time: string;
}
