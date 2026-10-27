// vue-loader 15 imports a default value for every style block, although its
// pitcher only forwards a default export for CSS modules. Ordinary styles are
// side effects: retain their injection without requesting a nonexistent export.
module.exports = function vueStyleImports(source) {
  if (this.resourceQuery) {
    return source
  }
  return source.replace(
    /^import style\d+ from ("(?:[^"\\]|\\.)*")\r?$/gm,
    (statement, requestLiteral) => {
      const request = JSON.parse(requestLiteral)
      const query = new URLSearchParams(request.slice(request.indexOf('?') + 1))
      if (query.get('type') !== 'style' || query.has('module')) {
        return statement
      }
      return `import ${requestLiteral}`
    },
  )
}
