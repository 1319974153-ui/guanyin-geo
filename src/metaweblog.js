import {createXmlRpcPublisher} from './xmlrpc-publisher.js';
const adapter=createXmlRpcPublisher('metaweblog');
export const {api:metaweblogApi,account:metaweblogAccount,provider:metaweblogProvider,runState:metaweblogRunState}=adapter;
