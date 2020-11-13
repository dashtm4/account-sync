import AWS from 'aws-sdk';
import middy from 'middy';
import { jsonBodyParser } from 'middy/middlewares';
import Boom from '@hapi/boom';
import { APIGatewayEvent, DefaultResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const rawHandler = async (event: any)
: Promise<any> => {
    var Airtable = require('airtable');
    Airtable.configure({
        endpointUrl: 'https://api.airtable.com',
        apiKey: process.env.AIRTABLE_API_KEY
    });
    var base = Airtable.base('appSgOJ4dAfje507d');
    base('Contacts').create([
        {
          "fields": {
            "Phone #": event.Detail.OfficePhoneNumber,
            "Name": event.Detail.Name,
            "Email Address": event.Detail.Address
          }
        },
      ], function(err: any, records: any) {
        if (err) {
          console.error(err);
          return;
        }
        records.forEach(function (record: any) {
          console.log(record.getId());
        });
      });
    return { message: 'Successfully signed new user' };
};

