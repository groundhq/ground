<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import {getAuthManager, getSdk} from '$lib/utils';
	import {Context} from 'ground-data';

	const auth = getAuthManager();
	const idInfo = auth.getIdentityInfo();

	const sdk = getSdk();

	let cancelled = false;

	let items: Array<{index: number; value: string}> = $state([]);
	let itemValue: string = $state('');

	const topic = `topic-${Math.random().toString().split('.')[1]}`;

	async function publish() {
		await sdk.coordinatorRpc.streamPut(Context.todo(), {
			topic,
			value: itemValue,
		});
	}

	$effect(() => {
		(async () => {
			try {
				console.log('stream start');
				const interval$ = sdk.coordinatorRpc.getStream(Context.todo(), {
					topic,
				});
				for await (const item of interval$) {
					console.log('stream item', item.index);

					items.push(item);

					if (cancelled) {
						console.log('stream break');
						break;
					}
				}

				console.log('stream complete');
			} catch (error) {
				console.log('stream error', error);
			} finally {
				console.log('stream closed');
			}
		})();
	});
</script>

{#if idInfo}
	<div>
		<Button onclick={() => auth.logOut()}>Log out</Button>
	</div>
	User: {idInfo.userId}
{:else}
	<Button href="/log-in">Log in</Button>
{/if}

<Button onclick={() => (cancelled = true)}>Stop stream</Button>
<Input bind:value={itemValue} type="text" />
<Button onclick={publish}>Publish into stream</Button>

<div>
	{#each items as item}
		<div>
			{item.index} - {item.value}
		</div>
	{/each}
</div>
