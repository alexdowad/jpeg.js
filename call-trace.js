/* For debugging */

function traceMethodCalls(cls) {
  for (const methodName of Object.getOwnPropertyNames(cls.prototype)) {
    const method = cls.prototype[methodName];
    if (typeof(method) === 'function') {
      cls.prototype[methodName] = function(...args) {
        console.log(`${methodName}(${args.map((x) => x.toString()).join(', ')})`);
        return method.apply(this, args);
      }
    }
  }
}
