const express = require('express');
const cors = require('cors');
const session = require('express-session');
const topRouter = require('./top');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
    secret: 'mc-stable-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

app.use('/', topRouter);

app.get('/shop', (req, res) => {
    if (!req.session.playerUuid) return res.send("未登录");
    res.send(`<h1>商城</h1><p>欢迎: ${req.session.playerUuid}</p>`);
});

app.listen(3000, () => console.log("稳定版 SSO+交易模块 已启动: http://localhost:3000"));