const CompilerHooksWebpackPlugin = require('compilerhooks-webpack-plugin')

const emptyHook = (async () => {})
class WebpackSeriesPlugin {

	constructor(cb) {
		this.cb = cb || emptyHook
	}

	apply(compiler) {
	}
}

function WebpackSeries(configs) {
	//In case of multiple builds in a row
	let firstRun = true
	let runCount = 0
	//Setup file dependencies to cascade watches (afterCompile hook)
	let fileDependencies = []
	//Setup promises to wait until previous build is finished (beforeCompile hook)
	let promises = []
	//Setup resolvers to notify next build we're finished (done hook)
	let resolvers = []
	//Setup plugin promises to wait until previous build plugins finish (beforeCompile hook)
	let pluginsWithPromises = []

	for (let i = 0; i < configs.length; i++) {

		const config = configs[i]
		const isFirstConfig = i === 0

		//Get current plugin callback which will wait for previous build plugins (beforeCompile hook)
		const { cb: resolvePromisesCb } = config.plugins.find(plugin => plugin instanceof WebpackSeriesPlugin) || new WebpackSeriesPlugin()

		//Create and store the initial promise waited for by next in series after this is resolved (done and beforeCompile hooks)
		promises[i] = new Promise(resolve => {
			resolvers[i] = resolve
		})

		//Filter plugins without the "series promise API"
		pluginsWithPromises[i] = config.plugins.filter(plugin => !!plugin.promise)

		//Add a plugin that will coordinate builds by waiting for previous compile to finish (beforeCompile and done hooks)
		// also wait for any plugins of previous compile to finish before compile (beforeCompile hook)
		// and cascade file changes so compiles cascade during watch
		config.plugins.push(new CompilerHooksWebpackPlugin({
			watchRun: async () => {
				//Avoid resetting promises before anything is even finished, God willing
				if (firstRun) {
					return
				}

				//Reset promises for the next full series, God willing.
				//Watch only runs for those that are about to run.
				const previousPluginsWithPromises = pluginsWithPromises[i] || []

				previousPluginsWithPromises.forEach(plugin => {
					plugin.promise = new Promise((resolve) => {
						plugin.resolve = resolve
					})
				})

				promises[i] = new Promise(resolve => {
					resolvers[i] = resolve
				})
			},
			before: async () => {
				let pluginPromise = Promise.resolve() 

				if (!isFirstConfig) {
					const previousPluginsWithPromises = pluginsWithPromises[i - 1] || []

					//Plugin series api passes an alias for itself (or use constructor name) for the WebpackSeriesPlugin to use and wait for results before we start compiling
					pluginPromise = resolvePromisesCb(previousPluginsWithPromises.reduce((promises, plugin) => {
						const promiseResultAlias = plugin.promiseResultAlias || plugin.constructor.name
						promises[promiseResultAlias] = plugin.promise
						return promises
					}, {}))
				}

				//Wait for previous and let WebpackSeriesPlugin callback wait for plugin results, God willing.
				if (!isFirstConfig || !firstRun) {
					const previousFinishedPromise = !isFirstConfig ? promises[i - 1] : promises[promises.length - 1]
					await Promise.all([previousFinishedPromise, pluginPromise])
				}
			},
			after: async (compilation) => {

				if (!isFirstConfig) {
					//Add file dependencies from previous and update our own list for the next to use
					fileDependencies[i - 1].forEach((dependency) => {
						compilation.fileDependencies.add(dependency)
					})
				}

				fileDependencies[i] = compilation.fileDependencies
			},
			done: async () => {
				//Resolve our promise for next to continue (in beforeHook)
				resolvers[i]()

				if (firstRun && isFirstConfig) {
					firstRun = false
				}
			}
		}))
	}

	return configs
}

module.exports = { WebpackSeriesPlugin, WebpackSeries }