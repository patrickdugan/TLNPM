const ApiWrapper = require('./algoAPI.js');

const address = 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf'
const pubkey = "03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677"
const api = new ApiWrapper('ws://172.81.181.19', 3001, true, true, address, pubkey, 'LTCTEST');

(async () => {
  await api.delay(1500);

  const me = api.getMyInfo();
  console.log('me:', me.address);

  const spot = await api.getSpotMarkets();
  console.log('spot:', Array.isArray(spot) ? spot.length : 0);

  const ob = await api.getOrderbookData({ type: 'SPOT', first_token: 0, second_token: 5 });
  console.log('orderbook levels:', { bids: ob?.bids?.length || 0, asks: ob?.asks?.length || 0 });

const order = {
  type: 'FUTURES',
  action: 'SELL',          // SELL = open short
  isLimitOrder: true,
  keypair: {
    address,
    pubkey
  },
  props: {
    contractId: 3,         // futures contract id
    price: 100,
    amount: 1              // number of contracts
  }
};


  const uuid = await api.sendOrder(order);
  console.log('order sent:', uuid);
})();
