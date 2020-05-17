const WETH = artifacts.require('WETH9');
const AdvancedWETH = artifacts.require('AdvancedWETH');
const TargetContract = artifacts.require('TargetContract');
const BN = require('bn.js');

contract('AdvancedWETH', ([account0, account1, account2, account3]) => {
  let weth;
  let advancedWeth;
  let targetContract;

  let balancesBefore;

  async function getBalance(address) {
    return new BN((await web3.eth.getBalance(address)).toString());
  }

  async function recordBalanceBefore(address) {
    balancesBefore[ address ] = await getBalance(address);
  }

  async function checkBalanceDifference(address, diff) {
    const after = await getBalance(address);
    expect(after.sub(balancesBefore[ address ]).toString()).to.eq(diff.toString());
  }

  function sendETH(to, amount, from) {
    return web3.eth.sendTransaction({ to, value: amount, from });
  }

  function encodeTargetCallData(wethAddress, amount) {
    return web3.eth.abi.encodeFunctionCall({
      'inputs': [
        {
          'internalType': 'address payable',
          'name': 'weth',
          'type': 'address'
        },
        {
          'internalType': 'uint256',
          'name': 'amount',
          'type': 'uint256'
        }
      ],
      'name': 'targetCall',
      'type': 'function'
    }, [wethAddress, amount]);
  }

  async function expectError(fn, msg) {
    let threw = false;
    try {
      await (typeof fn === 'function' ? fn() : fn);
    } catch (error) {
      threw = true;
      expect(error.message).to.contain(msg);
    }
    expect(threw).to.eq(true);
  }

  beforeEach('reset balancesBefore', () => {
    balancesBefore = {};
  });

  beforeEach('deploy WETH', async () => {
    weth = await WETH.new();
  });

  beforeEach('deploy AdvancedWETH', async () => {
    advancedWeth = await AdvancedWETH.new(weth.address);
  });

  beforeEach('deploy TargetContract', async () => {
    targetContract = await TargetContract.new();
  });

  it('is deployed', () => {
    expect(weth.address).to.be.a('string');
    expect(advancedWeth.address).to.be.a('string');
  });

  it('points at weth', async () => {
    expect(await advancedWeth.weth()).to.eq(weth.address);
  });

  describe('#approveAndCall', () => {
    beforeEach('make some weth', async () => {
      await weth.deposit({ value: 100, from: account0 });
    });

    it('fails if weth not approved', async () => {
      await targetContract.update(0, 100);
      await expectError(advancedWeth.approveAndCall(1, targetContract.address, encodeTargetCallData(weth.address, 1)), 'revert');
    });
    it('fails if target contract reverts', async () => {
      await targetContract.update(0, 0);
      await expectError(advancedWeth.approveAndCall(1, targetContract.address, encodeTargetCallData(weth.address, 1)), 'revert');
    });

    it('succeeds when weth approved', async () => {
      await weth.approve(advancedWeth.address, 100, { from: account0 });
      await targetContract.update(0, 1);
      await advancedWeth.approveAndCall(1, targetContract.address, encodeTargetCallData(weth.address, 1));
    });

    it('transfers the called amount weth and refunds remainder as eth', async () => {
      await weth.approve(advancedWeth.address, 100, { from: account0 });
      await targetContract.update(0, 50);
      await recordBalanceBefore(account0)
      await advancedWeth.approveAndCall(25, targetContract.address, encodeTargetCallData(weth.address, 20), {gasPrice: 0});
      await checkBalanceDifference(account0, 5) // 5 refunded as eth of the 25 approved/transferred
      expect((await weth.balanceOf(account0)).toNumber()).to.eq(75); // whole approved amount transferred
      expect((await weth.balanceOf(targetContract.address)).toNumber()).to.eq(20); // target call took 20 of the 25
    });
  });

  describe('#receive', () => {
    it('reject if not from weth', async () => {
      await expectError(sendETH(advancedWeth.address, 1, account0), 'WETH_ONLY');
    });
  });

  describe('#withdrawTo', () => {
    beforeEach('make some weth', async () => {
      await weth.deposit({ value: 100, from: account0 });
    });

    it('no-op if empty', async () => {
      await advancedWeth.withdrawTo(account1, { from: account0 });
      expect((await weth.balanceOf(account0)).toNumber()).to.eq(100);
      expect((await weth.balanceOf(account1)).toNumber()).to.eq(0);
    });

    it('forwards balance as eth', async () => {
      await weth.transfer(advancedWeth.address, 25, { from: account0 });
      expect((await weth.balanceOf(account0)).toNumber()).to.eq(75);
      expect((await weth.balanceOf(advancedWeth.address)).toNumber()).to.eq(25);

      await recordBalanceBefore(account2);
      await advancedWeth.withdrawTo(account2, { from: account1 }); // diff account than depositor
      expect((await weth.balanceOf(advancedWeth.address)).toNumber()).to.eq(0);
      expect((await weth.balanceOf(account2)).toNumber()).to.eq(0); // no weth on the target account
      await checkBalanceDifference(account2, 25);
    });

    // ends up depositing right back into advanced weth
    it('withdrawTo WETH is no-op', async () => {
      await weth.transfer(advancedWeth.address, 25, { from: account0 });
      await advancedWeth.withdrawTo(weth.address, { from: account0 });
      expect((await weth.balanceOf(advancedWeth.address)).toNumber()).to.eq(25);
    });

    it('fails if to address does not receive eth', async () => {
      await weth.transfer(advancedWeth.address, 25, { from: account0 });
      await expectError(advancedWeth.withdrawTo(targetContract.address, { from: account0 }), 'WITHDRAW_TO_CALL_FAILED');
    });
  });
});