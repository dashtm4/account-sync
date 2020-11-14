
export const handler = function(event: any, context: any, callback: any) {
    if (process.env.environment == "production"){
        var Airtable = require('airtable');
        Airtable.configure({
            endpointUrl: 'https://api.airtable.com',
            apiKey: process.env.AIRTABLE_API_KEY
        });
        var base = Airtable.base('appSgOJ4dAfje507d');
        base('Contacts').create({
            "Phone #": event.detail.Item.OfficePhoneNumber,
            "Name": event.detail.Item.Name,
            "Email Address": event.detail.Item.Email
        }, function (err: any, record: any) {
            if (err) {
                console.error(err);
                return callback(Error(err));
            }else{
                return callback(null, 200);
            }
        });
    };
};


