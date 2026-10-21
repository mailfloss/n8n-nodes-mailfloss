import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type JsonObject,
} from 'n8n-workflow';

export async function mailflossApiRequest(
	this: IExecuteFunctions | IHookFunctions,
	method: IHttpRequestMethods,
	path: string,
	{ body, qs, itemIndex }: { body?: IDataObject; qs?: IDataObject; itemIndex?: number } = {},
): Promise<IDataObject> {
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'mailflossApi', {
			method,
			url: `https://api.mailfloss.com${path}`,
			body,
			qs,
			json: true,
		})) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}
