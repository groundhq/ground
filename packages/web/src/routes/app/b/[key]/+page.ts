import {pageSdk} from '$lib/utils.js';
import type {PageLoad} from './$types.js';

export const load: PageLoad = async ({params, data}) => {
	const boardKey = params.key;
	const initialBoard = await pageSdk(data.serverCookies, x =>
		x.getBoard({key: boardKey}).then(x => x[0])
	);

	return {
		initialBoard,
		boardKey,
	};
};
