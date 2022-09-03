const jsonResp = require('./lib/RpcResponse');
const jsonError = require('./lib/RpcError');
const crypto = require('crypto');
const parse = require('co-body');
const InvalidParamsError = require('./lib/RpcInvalidError');
const hasOwnProperty = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

class koaJsonRpc {
  constructor (opts) {
    this.limit = '1mb';
    this.registry = Object.create(null);
    if (opts) {
      this.limit = opts.limit || this.limit;
      this.auth = opts.auth;
    }
    if (this.auth && (!hasOwnProperty(this.auth, 'username') || !hasOwnProperty(this.auth, 'password'))) {
      throw new Error('Invalid options parameters!');
    }
    if (this.auth) {
      this.token = crypto.createHmac('sha256', this.auth.password).update(this.auth.username).digest('hex');
    }
  }
  use (name, func) {
    this.registry[name] = func;
  }
  app () {
    return async (ctx, next) => {
      let body;
      if (this.token) {
        const headerToken = ctx.get('authorization').split(' ').pop();
        if (headerToken !== this.token) {
          ctx.body = jsonResp(null, jsonError.Unauthorized());
          return;
        }
      }
      try {
        body = await parse.json(ctx, { limit: this.limit });
      } catch (err) {
        const errBody = jsonResp(null, jsonError.ParseError());
        ctx.body = errBody;
        return;
      }

      if (!Array.isArray(body)) {
        let result;
        let rpcCall = body;

        if (rpcCall.jsonrpc !== '2.0' || !hasOwnProperty(rpcCall, 'method') || !hasOwnProperty(rpcCall, 'id') || ctx.request.method !== 'POST') {
          ctx.body = jsonResp(rpcCall.id || null, jsonError.InvalidRequest());
          return;
        }
        if (!this.registry[rpcCall.method]) {
          ctx.body = jsonResp(rpcCall.id, jsonError.MethodNotFound());
          return;
        }
        try {
          result = await this.registry[rpcCall.method](rpcCall.params);
        } catch (e) {
          if (e instanceof InvalidParamsError) {
            ctx.body = jsonResp(rpcCall.id, jsonError.InvalidParams(e.message));
            return;
          }
          ctx.body = jsonResp(rpcCall.id, jsonError.InternalError(e.message));
          return;
        }
        ctx.body = jsonResp(rpcCall.id, null, result);
      } else {
        let promises = [];

        for (let i = 0; i < body.length; i++) {
          let rpcCall = body[i];

          if (rpcCall.jsonrpc !== '2.0' || !hasOwnProperty(rpcCall, 'method') || !hasOwnProperty(rpcCall, 'id') || ctx.request.method !== 'POST') {
            ctx.body = jsonResp(rpcCall.id || null, jsonError.InvalidRequest());
            return;
          }
          if (!this.registry[rpcCall.method]) {
            ctx.body = jsonResp(rpcCall.id, jsonError.MethodNotFound());
            return;
          }


          let promise = this.registry[rpcCall.method](rpcCall.params)
              .catch((e=>{
                  if (e instanceof InvalidParamsError) {
                    ctx.body = jsonResp(rpcCall.id, jsonError.InvalidParams(e.message));
                    return;
                  }
                  ctx.body = jsonResp(rpcCall.id, jsonError.InternalError(e.message));
              })).then(value => jsonResp(rpcCall.id, null, value));
          promises.push(promise);
        }
        ctx.body = await Promise.all(promises);
      }
    };
  }
}
module.exports = (...args) => new koaJsonRpc(...args);

module.exports.InvalidParamsError = InvalidParamsError;
