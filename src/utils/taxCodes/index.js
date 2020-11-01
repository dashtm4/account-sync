const fs = require('fs');
const AWS = require('aws-sdk');
const { v4 } = require('uuid');

const db = new AWS.DynamoDB.DocumentClient({
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
});

const path = './';

fs.readdir(path, (err, files) => {
    for (const file of files) {
        if (file.includes('.js')) continue;

        const readFile = fs.readFileSync(`${path}${file}`);

        let EntityType;

        switch (file) {
            case 'csiC.txt':
                EntityType = 'Corp (C)';
                break;
            case 'csiS.txt':
                EntityType = 'Corp (S)';
                break;
            case 'csiI.txt':
                EntityType = 'Sole Proprietor (I)';
                break;
            case 'csiP.txt':
                EntityType = 'Partnership (P)';
                break;
        }

        const data = readFile.toString().replace(new RegExp('\r', 'g'), '').split('\n');

        for (let i = 2; i < data.length - 1; i++) {
            const taxCode = data[i];

            const tax = taxCode.split('\t');

            const obj = {
                Id: v4(),
                TaxCode: tax[0],
                EntityType,
                TaxCodeDescription: tax[1],
                FormLine: tax[2],
                Toggle: tax[3],
            }

            db.put({
                TableName: 'taxcodes_table',
                Item: { ...obj },
            });

        }
    }
});