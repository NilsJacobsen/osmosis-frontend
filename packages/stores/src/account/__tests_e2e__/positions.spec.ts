/* eslint-disable */
import { ObservableQueryPool } from "src/queries";
import {
  chainId,
  getLatestQueryPool,
  RootStore,
  waitAccountLoaded,
} from "../../__tests_e2e__/test-env";
import { maxTick, minTick, priceToTick } from "@osmosis-labs/math";
import { Int } from "@keplr-wallet/unit";
// import { Int } from "@keplr-wallet/unit";

describe("Create CL Positions Txs", () => {
  const { accountStore, queriesStore, chainStore } = new RootStore();
  const account = accountStore.getAccount(chainId);
  const osmosisQueries = queriesStore.get(chainId).osmosis!;

  let queryPool: ObservableQueryPool | undefined;

  beforeAll(async () => {
    const account = accountStore.getAccount(chainId);
    account.cosmos.broadcastMode = "sync";
    await waitAccountLoaded(account);
  });

  beforeEach(async () => {
    // prepare CL pool
    await new Promise((resolve, reject) =>
      account.osmosis.sendCreateConcentratedPoolMsg(
        "uion",
        "uosmo",
        1,
        0.001, // must have spread factor to generate fees
        undefined,
        (tx) => {
          if (tx.code) reject(tx.log);
          else resolve(tx);
        }
      )
    );

    queryPool = await getLatestQueryPool(chainId, queriesStore);
  });

  it("should be able to be created - full range", async () => {
    await expect(createFullRangePosition(queryPool!.id)).resolves.toBeDefined();
    await expect(
      getUserPositionsIdsForPool(queryPool!.id)
    ).resolves.toHaveLength(1);
    await expect(createFullRangePosition(queryPool!.id)).resolves.toBeDefined();
    await expect(
      getUserPositionsIdsForPool(queryPool!.id)
    ).resolves.toHaveLength(2);
  });

  it("should be be able to be created - below current price", async () => {
    // create initial position to move the price from 0 to 1 in fresh pool
    await createFullRangePosition(queryPool!.id);

    // refresh pool to get updated price
    await queryPool!.waitFreshResponse();

    // desired quote asset only, all tokens below current price consist of token1
    const osmoCurrency = chainStore
      .getChain(chainId)
      .forceFindCurrency("uosmo");
    const osmoSwapAmount = "10";

    // get current tick, subtract to be below current price
    const currentTick = priceToTick(
      queryPool!.concentratedLiquidityPoolInfo!.currentSqrtPrice.mul(
        queryPool!.concentratedLiquidityPoolInfo!.currentSqrtPrice
      )
    ).sub(new Int(1));

    // create CL position
    await expect(
      new Promise<any>((resolve, reject) => {
        account.osmosis
          .sendCreateConcentratedLiquidityPositionMsg(
            queryPool!.id,
            minTick,
            currentTick,
            undefined,
            {
              currency: osmoCurrency,
              amount: osmoSwapAmount,
            },
            undefined,
            undefined,
            (tx) => {
              if (tx.code) reject(tx.log);
              else resolve(tx);
            }
          )
          .catch(reject);
      })
    ).resolves.toBeDefined();
  });

  it("should be be able to be created - above current price", async () => {
    // create initial position to move the price from 0 to 1 in fresh pool
    await createFullRangePosition(queryPool!.id);

    // refresh pool to get updated price
    await queryPool!.waitFreshResponse();

    // desired base asset only, all tokens above current price consist of token0
    const ionCurrency = chainStore.getChain(chainId).forceFindCurrency("uion");
    const ionSwapAmount = "10";

    // get current tick, add to be below above price
    const currentTick = priceToTick(
      queryPool!.concentratedLiquidityPoolInfo!.currentSqrtPrice.mul(
        queryPool!.concentratedLiquidityPoolInfo!.currentSqrtPrice
      )
    ).add(new Int(1));

    // create CL position
    await expect(
      new Promise<any>((resolve, reject) => {
        account.osmosis
          .sendCreateConcentratedLiquidityPositionMsg(
            queryPool!.id,
            currentTick,
            maxTick,
            {
              currency: ionCurrency,
              amount: ionSwapAmount,
            },
            undefined,
            undefined,
            undefined,
            (tx) => {
              if (tx.code) reject(tx.log);
              else resolve(tx);
            }
          )
          .catch(reject);
      })
    ).resolves.toBeDefined();
  });

  it("can have liquidity be added to it", async () => {
    // create 2 positions, since there need to be at least 2 to be able to add liquidity
    await createFullRangePosition(queryPool!.id);
    await createFullRangePosition(queryPool!.id);
    const userPositionIds = await getUserPositionsIdsForPool(queryPool!.id);
    const lastPositionId = userPositionIds[userPositionIds.length - 1];

    // add liquidity to position
    const specifiedAmount0 = "1000";
    const calculatedAmount1 = "1000";

    await expect(
      new Promise((resolve, reject) =>
        account.osmosis
          .sendAddToConcentratedLiquidityPositionMsg(
            lastPositionId,
            specifiedAmount0,
            calculatedAmount1,
            undefined,
            undefined,
            (tx) => {
              if (tx.code) reject(tx.log);
              else resolve(tx);
            }
          )
          .catch(reject)
      )
    ).resolves.toBeDefined();

    // old position is replaced
    // we can't rely on position IDs as other positions may have been globally created first in future tests
    await expect(
      getUserPositionsIdsForPool(queryPool!.id)
    ).resolves.toHaveLength(2);
  });

  it("rejects adding liquidity to position if last position in pool", async () => {
    // create initial position
    await createFullRangePosition(queryPool!.id);
    const userPositionIds = await getUserPositionsIdsForPool(queryPool!.id);
    const lastPositionId = userPositionIds[userPositionIds.length - 1];

    // add liquidity to position
    const specifiedAmount0 = "1000";
    const calculatedAmount1 = "1000";

    await expect(
      new Promise((resolve, reject) =>
        account.osmosis
          .sendAddToConcentratedLiquidityPositionMsg(
            lastPositionId,
            specifiedAmount0,
            calculatedAmount1,
            undefined,
            undefined,
            (tx) => {
              if (tx.code) reject(tx.log);
              else resolve(tx);
            }
          )
          .catch(reject)
      )
    ).rejects.toBeDefined();
  });

  /** Leave `poolId` undefined to get all position IDs. */
  async function getUserPositionsIdsForPool(poolId?: string) {
    const positions = osmosisQueries.queryAccountsPositions.get(
      account.bech32Address
    );
    await positions.waitFreshResponse();

    return positions.positions
      .filter((position) => !poolId || position.poolId === poolId)
      .map((position) => position.id);
  }

  function createFullRangePosition(poolId: string) {
    const osmoCurrency = chainStore
      .getChain(chainId)
      .forceFindCurrency("uosmo");
    const osmoSwapAmount = "10";

    const ionCurrency = chainStore.getChain(chainId).forceFindCurrency("uion");
    const ionSwapAmount = "10";

    // prepare CL position
    return new Promise<any>((resolve, reject) => {
      account.osmosis.sendCreateConcentratedLiquidityPositionMsg(
        poolId,
        minTick,
        maxTick,
        {
          currency: osmoCurrency,
          amount: osmoSwapAmount,
        },
        {
          currency: ionCurrency,
          amount: ionSwapAmount,
        },
        undefined,
        undefined,
        (tx) => {
          if (tx.code) reject(tx.log);
          else resolve(tx);
        }
      );
    });
  }
});
