<script lang="ts">
	import Avatar from '../components/Avatar.svelte';
	import BoardsList from '../components/boards/BoardsList.svelte';
	import Plus from '../components/icons/Plus.svelte';
	import Search from '../components/icons/Search.svelte';
	import NavigationStack from '../components/mobile/NavigationStack.svelte';
	import navigator from '../lib/navigator.js';

	let searchActive = $state(false);

	const onNewBoard = () => {
		navigator.navigate('/boards/new', {
			updateBrowserURL: true,
			updateState: true
		});
	};

	const onSearch = () => {
		searchActive = true;
	};
</script>

{#snippet leading()}
	<button onclick={onNewBoard} class="btn btn--icon">
		<Avatar title="Andrei" />
	</button>
{/snippet}

{#snippet bottomToolbar()}
	<div class="flex align-center justify-between">
		<button onclick={onSearch} class="btn btn--icon">
			<Search />
		</button>
		<button onclick={onNewBoard} class="btn btn--icon">
			<Plus />
		</button>
	</div>
{/snippet}

<NavigationStack
	navigationTitle="Boards"
	{leading}
	{bottomToolbar}
	bind:searchActive
	scrollTopOnTitleClick
>
	<BoardsList />
</NavigationStack>
