import { Wallet, Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { SiweMessage } from 'siwe';
import { request } from 'undici';
import 'dotenv/config';
import { promises as fs } from 'fs';
import { join } from 'path';

const PRIVY_APP_ID = 'cmf5gt8yi019ljv0bn5k8xrdw';
const EDEN_ORIGIN = 'https://testnet.edel.finance';
const PRIVY_ORIGIN = 'https://auth.privy.io';
const BACKEND_URL = 'https://new-backend-713705987386.europe-north1.run.app';
const RPC_URL_PRIMARY = 'https://base-mainnet.g.alchemy.com/v2/8tLSlmm95fjoFgamNTWgX';
const RPC_URL_FALLBACK = 'https://mainnet.base.org';

const AUTO_BUY_SPIN = (process.env.AUTO_BUY_SPIN?.trim() || 'false').toLowerCase() === 'true';
const BORROW_AFTER_SPIN = (process.env.BORROW_AFTER_SPIN?.trim() || 'false').toLowerCase() === 'true';
const DELAY_BETWEEN_ACCOUNTS_MS = parseInt(process.env.DELAY_BETWEEN_ACCOUNTS_MS || '2000', 10);
const SPIN_INTERVAL_MS = 3000;
const SPIN_REWARD_DELAY_MS = 25000;

const TOKENS = [
  { name: "Mock SPY",   symbol: "mockSPY",   address: "0x07C6a25739Ffe02b1dae12502632126fFA7497c2", decimals: 18 },
  { name: "Mock USDC",  symbol: "mockUSDC",  address: "0x66E8D8E1ba5cfaDB32df6CC0B45eA05Cc3d7201E", decimals: 6  },
  { name: "Mock TSLA",  symbol: "mockTSLA",  address: "0x119505B31d369d5cF27C149A0d132D8Cdd99Cf5e", decimals: 18 },
  { name: "Mock META",  symbol: "mockMETA",  address: "0x960e1155741108C85A9BB554F79165df939E66BB", decimals: 18 },
  { name: "Mock CRCL",  symbol: "mockCRCL",  address: "0xc1f76f5F8cab297a096Aec245b28B70B8822Bfa4", decimals: 18 },
  { name: "Mock HOOD",  symbol: "mockHOOD",  address: "0x856736DFf1579DDE3E35B278432c857Cb55Bc407", decimals: 18 },
  { name: "Mock AMZN",  symbol: "mockAMZN",  address: "0xA4a87f3F6b8aef9029f77edb55542cc32b8944D8", decimals: 18 },
  { name: "Mock PLTR",  symbol: "mockPLTR",  address: "0x6401999437FB8d6af9Df5AdEFe10D87F2AF3EC7d", decimals: 18 },
  { name: "Mock NVDA",  symbol: "mockNVDA",  address: "0x60C80e0086B1cFb0D21c9764E36d5bf469f7F158", decimals: 18 },
  { name: "Mock AAPL",  symbol: "mockAAPL",  address: "0xFBEfaE5034AA4cc7f3E9ac17E56d761a1bF211D4", decimals: 18 },
  { name: "Mock GOOGL", symbol: "mockGOOGL", address: "0x367A8A0A55f405AA6980e44f3920463ABC6BB132", decimals: 18 },
  { name: "Mock QQQ",   symbol: "mockQQQ",   address: "0xA0Aa9Dd11c6a770cEbB4772728538648F2de0F82", decimals: 18 },
  { name: "Mock USD1",  symbol: "mockUSD1",  address: "0xAA465B5B06687eDe703437A7bF42A52A356c6e6c", decimals: 18 },
];

const TOKEN_PRICES = {
  mockSPY: 700,
  mockUSDC: 1,
  mockTSLA: 460,
  mockMETA: 500,
  mockCRCL: 90,
  mockHOOD: 20,
  mockAMZN: 250,
  mockPLTR: 30,
  mockNVDA: 200,
  mockAAPL: 300,
  mockGOOGL: 320,
  mockQQQ: 650,
  mockUSD1: 1,
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const EDEL_LENDING_ABI = [
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt) reserveData)'
];

const EDEL_LENDING_CONTRACT = '0x0B72c91279A61cFcEc3FCd1BF30C794c69236e6e';
const SPIN_CONTRACT = '0x6fe7938cdea9b04315b48ef60e325e19790cf5f6';
const SPIN_ABI = [
  'function freeSpins(address) view returns (uint256)',
  'function paidSpins(address) view returns (uint256)',
  'function lastSpinPurchaseTimestamp(address) view returns (uint256)'
];

const BUY_SPIN_CONTRACT = '0x6fe7938cdea9b04315b48ef60e325e19790cf5f6';
const EDEL_TOKEN = '0xFb31f85A8367210B2e4Ed2360D2dA9Dc2D2Ccc95';
const BUY_SPIN_ABI = ['function buySpin(uint8 paymentMethod, address referral)'];

const BASE_HEADERS = {
  'accept': 'application/json',
  'content-type': 'application/json',
  'origin': EDEN_ORIGIN,
  'referer': `${EDEN_ORIGIN}/`,
  'privy-app-id': PRIVY_APP_ID,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

async function getProvider() {
  let provider = new JsonRpcProvider(RPC_URL_PRIMARY);
  try {
    await provider.getNetwork();
    console.log('✅ Using primary RPC (Alchemy)');
    return provider;
  } catch (err) {
    console.warn('⚠️ Primary RPC failed. Falling back...');
    provider = new JsonRpcProvider(RPC_URL_FALLBACK);
    await provider.getNetwork();
    console.log('✅ Using fallback RPC (mainnet.base.org)');
    return provider;
  }
}

function getTokenPriceUsd(_tokenAddress, symbol) {
  const price = TOKEN_PRICES[symbol];
  if (price === undefined) {
    console.warn(`⚠️ Unknown token symbol: ${symbol}, using $1`);
    return 1.0;
  }
  return price;
}

async function step1_initSiwe(walletAddress, headers) {
  console.log('🔄 Step 1: Requesting SIWE challenge...');
  const res = await request(`${PRIVY_ORIGIN}/api/v1/siwe/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ address: walletAddress }),
  });
  if (res.statusCode !== 200) {
    const text = await res.body.text();
    throw new Error(`SIWE init failed: ${res.statusCode} - ${text}`);
  }
  const data = await res.body.json();
  console.log('✅ Got SIWE challenge.');
  return data;
}

async function step2_authenticateSiwe(challenge, wallet, headers) {
  console.log('🔄 Step 2: Signing and authenticating SIWE...');
  const siweMessage = new SiweMessage({
    domain: 'testnet.edel.finance',
    address: wallet.address,
    statement: 'By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.',
    uri: EDEN_ORIGIN,
    version: '1',
    chainId: 8453,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    resources: ['https://privy.io'],
  });

  const messageToSign = siweMessage.prepareMessage();
  const signature = await wallet.signMessage(messageToSign);

  const authRes = await request(`${PRIVY_ORIGIN}/api/v1/siwe/authenticate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: messageToSign,
      signature,
      chainId: 'eip155:8453',
      walletClientType: 'injected',
      connectorType: 'injected',
      mode: 'login-or-sign-up',
    }),
  });

  if (authRes.statusCode !== 200) {
    const err = await authRes.body.text();
    throw new Error(`SIWE authenticate failed: ${authRes.statusCode} - ${err}`);
  }

  const authData = await authRes.body.json();
  if (!authData || !authData.token) {
    throw new Error('Authentication failed: no token in response');
  }
  console.log('✅ SIWE authenticated. Got Privy JWT.');
  return authData.token;
}

async function step3_loginToEdel(jwt, walletAddress, headers) {
  console.log('🔄 Step 3: Logging into Edel backend...');
  try {
    const payloadB64 = jwt.split('.')[1];
    if (!payloadB64) throw new Error('JWT is missing payload');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url'));
    const privyUserId = payload.sub;
    if (!privyUserId) throw new Error('JWT missing "sub" claim');

    const loginRes = await request(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { ...headers, 'authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ walletAddress, privyUserId }),
    });

    const resText = await loginRes.body.text();
    if (loginRes.statusCode !== 200) {
      throw new Error(`Edel login failed: ${loginRes.statusCode} - ${resText}`);
    }

    let edelSession;
    try {
      edelSession = JSON.parse(resText);
    } catch (e) {
      throw new Error(`Invalid JSON: ${resText}`);
    }

    if (!edelSession.success) {
      throw new Error(`Login not successful: ${resText}`);
    }

    console.log('✅ Successfully logged into Edel!');
    return { jwt, session: edelSession };
  } catch (e) {
    throw new Error(`Login failed: ${e.message}`);
  }
}


async function attemptSpin(jwt, wallet, useFreeSpin, headers) {
  const walletAddress = wallet.address;
  console.log(`🔄 Attempting ${useFreeSpin ? 'free' : 'paid'} spin...`);
  const timestamp = Date.now();
  const messageObject = { account: walletAddress, useFreeSpin, timestamp };
  const messageToSign = JSON.stringify(messageObject);
  const signature = await wallet.signMessage(messageToSign);

  const spinRes = await request(`${BACKEND_URL}/lucky-spin/spin`, {
    method: 'POST',
    headers: { ...headers, 'authorization': `Bearer ${jwt}` },
    body: JSON.stringify({ walletAddress, timestamp, useFreeSpin, signature }),
  });

  const spinData = await spinRes.body.json();
  if (spinRes.statusCode !== 200) {
    console.warn(`⚠️ ${useFreeSpin ? 'Free' : 'Paid'} spin failed:`, spinRes.statusCode, spinData);
    return null;
  }

  console.log('🎉 Spin successful! Tx:', spinData.txnHash);
  return spinData;
}

async function buySpinWithEDEL(wallet, referralAddress) {
  console.log('🛒 Attempting to buy 1 spin with EDEL...');
  const provider = await getProvider();
  const signer = wallet.connect(provider);
  const edel = new Contract(EDEL_TOKEN, ERC20_ABI, provider);
  const balance = await edel.balanceOf(wallet.address);
  const required = 10n * 10n ** 18n;

  if (balance < required) {
    console.warn('⚠️ Not enough EDEL balance (need 10 EDEL)');
    return false;
  }

  console.log('⏳ Approving 10 EDEL...');
  const approveTx = await edel.connect(signer).approve(BUY_SPIN_CONTRACT, required);
  await approveTx.wait();
  console.log('✅ Approved 10 EDEL');

  const buyContract = new Contract(BUY_SPIN_CONTRACT, BUY_SPIN_ABI, signer);
  const buyTx = await buyContract.buySpin(2, referralAddress);
  await buyTx.wait();
  console.log('🎉 Successfully bought 1 spin!');
  return true;
}

async function getSpinStatus(walletAddress) {
  const provider = await getProvider();
  const contract = new Contract(SPIN_CONTRACT, SPIN_ABI, provider);
  const [free, paid, lastPurchase] = await Promise.all([
    contract.freeSpins(walletAddress),
    contract.paidSpins(walletAddress),
    contract.lastSpinPurchaseTimestamp(walletAddress)
  ]);
  const now = Date.now();
  const lastMs = Number(lastPurchase) * 1000;
  const cooldownEnds = lastMs + 24 * 60 * 60 * 1000;
  return {
    freeSpins: Number(free),
    paidSpins: Number(paid),
    lastSpinPurchaseTimestamp: lastMs,
    canBuySpin: lastMs === 0 || now >= cooldownEnds,
    cooldownEnds
  };
}


async function checkAndSupplyTokens(wallet) {
  console.log('\n🔍 Checking token balances and supplying if available...');
  const provider = await getProvider();
  const signer = wallet.connect(provider);
  for (const token of TOKENS) {
    try {
      const erc20 = new Contract(token.address, ERC20_ABI, provider);
      const balance = await erc20.balanceOf(wallet.address);
      if (balance > 0n) {
        const formatted = formatUnits(balance, token.decimals);
        console.log(`📌 Found ${formatted} ${token.symbol} — supplying...`);

        const approveTx = await erc20.connect(signer).approve(EDEL_LENDING_CONTRACT, balance);
        await approveTx.wait();
        console.log(`✅ Approved ${token.symbol}`);

        const lending = new Contract(EDEL_LENDING_CONTRACT, EDEL_LENDING_ABI, signer);
        const depositTx = await lending.deposit(token.address, balance, wallet.address, 0);
        await depositTx.wait();
        console.log(`🎉 Supplied ${formatted} ${token.symbol} successfully!`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to supply ${token.symbol}:`, err.message);
    }
  }
}

async function borrowAllAssets(wallet) {
  const borrowConfig = process.env.AUTO_BORROW_USD?.trim();
  if (!borrowConfig) {
    console.log('⏭️ AUTO_BORROW_USD not set. Skipping borrow.');
    return;
  }

  const provider = await getProvider();
  const signer = wallet.connect(provider);
  const pool = new Contract(EDEL_LENDING_CONTRACT, EDEL_LENDING_ABI, provider);
  const borrower = new Contract(EDEL_LENDING_CONTRACT, EDEL_LENDING_ABI, signer);

  const accountData = await pool.getUserAccountData(wallet.address);
  const totalCollateralUSD = parseFloat(formatUnits(accountData.totalCollateralBase, 8));
  const maxBorrowableUSD = totalCollateralUSD * 0.2;

  let targetBorrowUSD;
  if (borrowConfig.endsWith('%')) {
    const percentValue = parseFloat(borrowConfig.replace('%', '').trim());
    if (isNaN(percentValue) || percentValue <= 0 || percentValue > 100) {
      console.warn('⚠️ Invalid percentage in AUTO_BORROW_USD (e.g., "20%")');
      return;
    }
    targetBorrowUSD = (percentValue / 100) * maxBorrowableUSD;
    console.log(`\n📥 Requested: borrow ${borrowConfig} of max available`);
  } else {
    const fixedValue = parseFloat(borrowConfig);
    if (isNaN(fixedValue) || fixedValue <= 0) {
      console.warn('⚠️ AUTO_BORROW_USD must be a number (e.g., "100") or percentage (e.g., "20%")');
      return;
    }
    targetBorrowUSD = Math.min(fixedValue, maxBorrowableUSD);
    console.log(`\n📥 Requested: borrow up to $${fixedValue}`);
  }

  targetBorrowUSD = Math.min(targetBorrowUSD, maxBorrowableUSD);
  if (targetBorrowUSD <= 0.01) {
    console.log('📭 Nothing to borrow (max borrow is $0 or config too small)');
    return;
  }

  console.log(`📊 Collateral value: $${totalCollateralUSD.toFixed(2)}`);
  console.log(`📊 Max borrowable (20% LTV): $${maxBorrowableUSD.toFixed(2)}`);
  console.log(`🎯 Will borrow: $${targetBorrowUSD.toFixed(2)}`);

  const eligible = [];
  for (const t of TOKENS) {
    try {
      const data = await pool.getReserveData(t.address);
      if (data[11]) eligible.push(t);
    } catch {
      console.warn(`⚠️ Skip ${t.symbol}`);
    }
  }

  if (eligible.length === 0) {
    console.log('📭 No eligible assets to borrow');
    return;
  }

  const perTokenUSD = targetBorrowUSD / eligible.length;
  console.log(`🧮 Per-token borrow target: ~$${perTokenUSD.toFixed(2)}`);

  for (const t of eligible) {
    try {
      const priceUsd = getTokenPriceUsd(t.address, t.symbol);
      if (priceUsd <= 0) {
        console.warn(`⚠️ Invalid price for ${t.symbol}, skipping`);
        continue;
      }

      const amountNative = perTokenUSD / priceUsd;
      const amount = parseUnits(amountNative.toFixed(Math.min(6, t.decimals)), t.decimals);
      const formattedAmount = formatUnits(amount, t.decimals);

      console.log(`📥 Borrowing $${perTokenUSD.toFixed(2)} worth of ${t.symbol} (price=$${priceUsd}, amount=${formattedAmount})`);

      const tx = await borrower.borrow(t.address, amount, 2n, 0, wallet.address);
      await tx.wait();
      console.log(`✅ Borrowed ${t.symbol} | Tx: ${tx.hash}`);
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.warn(`⚠️ Failed to borrow ${t.symbol}:`, e.message);
    }
  }
}

async function runForAccount(privateKey) {
  const wallet = new Wallet(privateKey.trim());
  const WALLET_ADDRESS = wallet.address;
  console.log(`\n🔍 Checking ${WALLET_ADDRESS} for spin eligibility...`);

  let spinStatus;
  try {
    spinStatus = await getSpinStatus(WALLET_ADDRESS);
  } catch (e) {
    console.warn(`⚠️ Failed to fetch spin status for ${WALLET_ADDRESS}`, e.message);
    return;
  }

  const hasFree = spinStatus.freeSpins > 0;
  const hasPaid = spinStatus.paidSpins > 0;
  const canAutoBuy = AUTO_BUY_SPIN && spinStatus.canBuySpin;

  let shouldLogin = hasFree || hasPaid;

  if (canAutoBuy && !shouldLogin) {
    try {
      const provider = await getProvider();
      const edel = new Contract(EDEL_TOKEN, ERC20_ABI, provider);
      const balance = await edel.balanceOf(WALLET_ADDRESS);
      const required = 10n * 10n ** 18n;
      if (balance >= required) {
        shouldLogin = true;
      } else {
        console.log(`⏭️ Skipping ${WALLET_ADDRESS}: no spins & EDEL < 10`);
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Failed to check EDEL balance for ${WALLET_ADDRESS}`, e.message);
      return;
    }
  }

  if (!shouldLogin) {
    console.log(`⏭️ No action needed for ${WALLET_ADDRESS}`);
    return;
  }

  console.log(`✅ Proceeding with login for ${WALLET_ADDRESS}`);
  const headers = { ...BASE_HEADERS };

  try {
    const challenge = await step1_initSiwe(WALLET_ADDRESS, headers);
    const jwt = await step2_authenticateSiwe(challenge, wallet, headers);
    const loginResult = await step3_loginToEdel(jwt, WALLET_ADDRESS, headers);

    const { session } = loginResult;
    const referredBy = session.user?.referredByWallet || WALLET_ADDRESS;
    console.log(`🔗 Referred by: ${referredBy}`);

    spinStatus = await getSpinStatus(WALLET_ADDRESS);
    let totalSpinsUsed = 0;

    while (spinStatus.freeSpins > 0) {
      console.log(`🎟️ Using free spin (${spinStatus.freeSpins} remaining)...`);
      const result = await attemptSpin(jwt, wallet, true, headers);
      if (result) totalSpinsUsed++;
      await new Promise(r => setTimeout(r, SPIN_INTERVAL_MS));
      spinStatus = await getSpinStatus(WALLET_ADDRESS);
    }

    while (spinStatus.paidSpins > 0) {
      console.log(`💰 Using paid spin (${spinStatus.paidSpins} remaining)...`);
      const result = await attemptSpin(jwt, wallet, false, headers);
      if (result) totalSpinsUsed++;
      await new Promise(r => setTimeout(r, SPIN_INTERVAL_MS));
      spinStatus = await getSpinStatus(WALLET_ADDRESS);
    }

    if (totalSpinsUsed === 0 && spinStatus.canBuySpin && AUTO_BUY_SPIN) {
      console.log('🔄 No spins used yet. Checking EDEL for auto-buy...');
      const provider = await getProvider();
      const edel = new Contract(EDEL_TOKEN, ERC20_ABI, provider);
      const balance = await edel.balanceOf(wallet.address);
      const required = 10n * 10n ** 18n;
      const balanceFormatted = parseFloat(formatUnits(balance, 18)).toFixed(4);
      console.log(`💰 EDEL Balance: ${balanceFormatted} (need 10.0)`);

      if (balance >= required) {
        console.log(`✅ Buying 1 spin with referral: ${referredBy}`);
        const bought = await buySpinWithEDEL(wallet, referredBy);
        if (bought) {
          await new Promise(r => setTimeout(r, 5000));
          spinStatus = await getSpinStatus(WALLET_ADDRESS);
          if (spinStatus.paidSpins > 0) {
            console.log('🔄 Using newly purchased spin...');
            const result = await attemptSpin(jwt, wallet, false, headers);
            if (result) totalSpinsUsed++;
          }
        }
      } else {
        console.log('⚠️ Not enough EDEL. Skipping buy.');
      }
    }

    if (totalSpinsUsed === 0) {
      console.log('⏭️ No spins performed. Skipping supply/borrow.');
      return;
    }

    console.log(`⏳ Waiting ${SPIN_REWARD_DELAY_MS / 1000} seconds for rewards to appear...`);
    await new Promise(r => setTimeout(r, SPIN_REWARD_DELAY_MS));

    await checkAndSupplyTokens(wallet);
    if (BORROW_AFTER_SPIN) {
      await borrowAllAssets(wallet);
    } else {
      console.log('⏭️ Borrow skipped (BORROW_AFTER_SPIN=false)');
    }
  } catch (err) {
    console.error(`💥 Fatal error for ${WALLET_ADDRESS}:`, err.message);
  }
}

let isShuttingDown = false;
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n🛑 Received shutdown signal. Stopping gracefully...');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  let privateKeys;
  try {
    const filePath = join(process.cwd(), 'privatekey.txt');
    const content = await fs.readFile(filePath, 'utf8');
    privateKeys = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (err) {
    console.error('❌ Failed to read privatekey.txt:', err.message);
    process.exit(1);
  }

  if (privateKeys.length === 0) {
    console.error('❌ No private keys found in privatekey.txt');
    process.exit(1);
  }

  console.log(`🚀 Found ${privateKeys.length} account(s). Starting infinite hourly check...`);
  console.log(`🕒 First check running now. Next check in 1 hour. Press Ctrl+C to stop.`);


  const runAll = async () => {
    if (isShuttingDown) return;
    for (let i = 0; i < privateKeys.length; i++) {
      if (isShuttingDown) break;
      if (i > 0) await new Promise(r => setTimeout(r, DELAY_BETWEEN_ACCOUNTS_MS));
      await runForAccount(privateKeys[i]);
    }
  };

  await runAll();


  setInterval(runAll, 60 * 60 * 1000);
}

main().catch(err => {
  console.error('💥 Unhandled error:', err);
  process.exit(1);
});
