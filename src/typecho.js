import {createXmlRpcPublisher} from './xmlrpc-publisher.js';
const adapter=createXmlRpcPublisher('typecho');
export const {api:typechoApi,account:typechoAccount,provider:typechoProvider,runState:typechoRunState,publicMatches:typechoPublicMatches}=adapter;
