# CampusEscrow 使用说明

这是校园面交用的 Solana Devnet 托管页面。程序已经部署，不需要再编译或部署。卖家挂单，买家把测试 SOL 锁进程序账户，买家确认后程序才把货款打给卖家。程序看不到实物，也不能处理见面时的争执。付款后如果一直不确认，钱会一直锁着，没有管理员能取回。

## 已经锁住、无法找回的一笔测试单

地址 `435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV` 仍是 Funded。余额 101493520 lamports，其中 100000000 是 0.1 测试 SOL，1493520 是租金。脚本在购买之后遇到 RPC 429，当时的一次性买家密钥没有保存，所以这笔不能确认，也不能隐藏。页面上会看到它。不要点它的确认，确认也不会是你的钱包。

另一笔已经完成：`94wKJzgqtpqCGhFwgscARZL39YV1bCkwHmF4RArAEvbE`，确认交易是 https://explorer.solana.com/tx/3kdHCgqKvvswBNzAKViW7htsAPWn1VSUbP1eGTzvjV9kCEy6LXx3T3ho1QXw7YBS6678g7YaWyzXHcji1xMo34F8?cluster=devnet 。程序地址是 https://explorer.solana.com/address/13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE?cluster=devnet 。

Phantom 里亲手签名还没有测过。下面的步骤只打开网页并读取这些真实订单。

## 打开网页

解压 `CampusEscrow-devnet.zip` 后，只进入这个目录：

`CampusEscrow/web`

`.env.example` 里的程序公钥就是上面已经部署的地址。不要改它，也不要在仓库根目录执行安装、测试或部署。

```bash
cd CampusEscrow/web
cp .env.example .env.local
npm ci
npm run dev
```

浏览器打开 http://127.0.0.1:43123 。这是你自己电脑上的地址。把 Phantom 的网络设为 Devnet，再点 Select Wallet。不连接钱包也能看到订单。连接之后可以签名，但这一步还没有被验证过。

如果页面上方出现 “Devnet RPC rate limit”，这是公共 Devnet 暂时拒绝读取，不是交易失败。等提示里的时间过去后点 Refresh。不要连续刷新。在读到新数据之前，挂单、购买、确认和取消都会停着。已经显示的订单会标明可能过期，不会被假装成最新结果。

改过页面代码后，要先在运行 `npm run dev` 的终端按 Ctrl+C 停掉，再在同一个 `CampusEscrow/web` 目录执行一次 `npm run dev`。不需要重新 `npm ci`，也不要删 `.env.local`。

页面上 Completed 的 “Used calculus textbook” 是已经放款的那笔。Funded 的同名订单就是丢了买家密钥的那笔。
