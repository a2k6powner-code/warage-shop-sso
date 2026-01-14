module.exports = {
  apps : [{
    name   : "mc-shop-core",
    script : "./server.js",
    instances : "max", // 利用所有 CPU 核心
    exec_mode : "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}