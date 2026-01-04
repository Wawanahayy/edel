import { Wallet, Contract, JsonRpcProvider, formatUnits } from 'ethers';
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
const DELAY_BETWEEN_ACCOUNTS_MS = parseInt(process.env.DELAY_BETWEEN_ACCOUNTS_MS || '2000', 10);
const SPIN_INTERVAL_MS = 3000;        // Delay antar spin
const SPIN_REWARD_DELAY_MS = 25000;   // Delay setelah spin sebelum supply

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

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];
const EDEL_LENDING_ABI = [
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
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
    uri: 'https://testnet.edel.finance',
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
  const messageObject = {
    account: walletAddress,
    useFreeSpin,
    timestamp
  };
  const messageToSign = JSON.stringify(messageObject);
  const signature = await wallet.signMessage(messageToSign);

  const spinRes = await request(`${BACKEND_URL}/lucky-spin/spin`, {
    method: 'POST',
    headers: { ...headers, 'authorization': `Bearer ${jwt}` },
    body: JSON.stringify({
      walletAddress,
      timestamp,
      useFreeSpin,
      signature,
    }),
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

  console.log('⏳ Buying spin (paymentMethod=2, referral=' + referralAddress + ')...');
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
  const lastPurchaseMs = Number(lastPurchase) * 1000;
  const cooldownEnds = lastPurchaseMs + 24 * 60 * 60 * 1000;
  const canBuySpin = lastPurchaseMs === 0 || now >= cooldownEnds;

  return {
    freeSpins: Number(free),
    paidSpins: Number(paid),
    lastSpinPurchaseTimestamp: lastPurchaseMs,
    canBuySpin,
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
        console.log(`✅ Approved ${token.symbol} | Tx: ${approveTx.hash}`);
        await approveTx.wait();

        const lending = new Contract(EDEL_LENDING_CONTRACT, EDEL_LENDING_ABI, signer);
        const depositTx = await lending.deposit(token.address, balance, wallet.address, 0);
        console.log(`📥 Deposited ${token.symbol} | Tx: ${depositTx.hash}`);
        await depositTx.wait();

        console.log(`🎉 Supplied ${formatted} ${token.symbol} successfully!`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to supply ${token.symbol}:`, err.message);
    }
  }
}

async function runForAccount(privateKey) {
  const wallet = new Wallet(privateKey.trim());
  const WALLET_ADDRESS = wallet.address;
  console.log(`\n🔑 Processing account: ${WALLET_ADDRESS}`);

  const headers = { ...BASE_HEADERS };

  try {
    const challenge = await step1_initSiwe(WALLET_ADDRESS, headers);
    const jwt = await step2_authenticateSiwe(challenge, wallet, headers);
    const loginResult = await step3_loginToEdel(jwt, WALLET_ADDRESS, headers);
    if (!loginResult || !loginResult.session) {
      throw new Error('Login result is invalid');
    }

    const { session } = loginResult;
    const referredBy = session.user?.referredByWallet || WALLET_ADDRESS;
    console.log(`🔗 Referred by: ${referredBy}`);

    console.log('\n🔐 Login success!');
    console.log(`Account: ${WALLET_ADDRESS}`);

    let spinStatus = await getSpinStatus(WALLET_ADDRESS);
    console.log('📊 Spin status:', spinStatus);

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
      console.log('🔄 No spins left. Checking EDEL for auto-buy...');
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
          await new Promise(r => setTimeout(r, 5000)); // Tunggu tx masuk
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

    if (totalSpinsUsed > 0) {
      console.log(`⏳ Waiting ${SPIN_REWARD_DELAY_MS / 1000} seconds for rewards to appear...`);
      await new Promise(r => setTimeout(r, SPIN_REWARD_DELAY_MS));
    }

    await checkAndSupplyTokens(wallet);
  } catch (err) {
    console.error(`💥 Fatal error for ${WALLET_ADDRESS}:`, err.message);
  }
}

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

  console.log(`🚀 Found ${privateKeys.length} account(s) to process.`);

  for (let i = 0; i < privateKeys.length; i++) {
    if (i > 0) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_ACCOUNTS_MS}ms before next account...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_ACCOUNTS_MS));
    }
    await runForAccount(privateKeys[i]);
  }

  console.log('\n✅ All accounts processed.');
}

main();
