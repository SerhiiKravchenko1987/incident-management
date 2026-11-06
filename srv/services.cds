using { sap.capire.incidents as my } from '../db/schema';
using { API_BUSINESS_PARTNER as bupa } from './external/API_BUSINESS_PARTNER';


/**
 * Service used by support personell, i.e. the incidents' 'processors'.
 */
service ProcessorService {
        entity Incidents as projection on my.Incidents {
        *,
        virtual null as businessPartnerName : String
    };


    @readonly entity Customers as projection on my.Customers;
    @readonly entity BusinessPartners as projection on bupa.A_BusinessPartner;

}

/**
 * Service used by administrators to manage customers and incidents.
 */
service AdminService {
    entity Customers as projection on my.Customers;
    entity Incidents as projection on my.Incidents;
    @readonly entity BusinessPartners as projection on bupa.A_BusinessPartner;

}

annotate ProcessorService with @(requires: 'support');
annotate AdminService with @(requires: 'admin')
