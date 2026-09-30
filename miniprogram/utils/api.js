const KEY = 'feicui.mini.token';
const URL_KEY = 'feicui.mini.url';

function baseUrl() { return String(wx.getStorageSync(URL_KEY) || 'http://127.0.0.1:3000').replace(/\/$/, ''); }
function token() { return wx.getStorageSync(KEY) || ''; }
function idempotencyKey(path, data) { return `${path}|${JSON.stringify(data||{})}`; }
function money(yuan) { return yuan == null ? '—' : `¥${Number(yuan).toFixed(2)}`; }
function fail(error) { wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 2500 }); }
function ensureLogin() {
  if (token()) return true;
  wx.reLaunch({ url: '/pages/login/index' });
  return false;
}
function request(path, method = 'GET', data, useToken = true) {
  return new Promise((resolve, reject) => {
    const auth = token();
    wx.request({
      url: `${baseUrl()}/api/v1/${path}`,
      method, data,
      header: {
        'content-type': 'application/json',
        'x-client': 'wechat-mini',
        ...(useToken && auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey(path, data) } : {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        if (res.statusCode === 401 && useToken) { wx.removeStorageSync(KEY); wx.reLaunch({ url: '/pages/login/index' }); }
        reject(new Error(res.data && res.data.error || `请求失败（${res.statusCode}）`));
      },
      fail(err) { reject(new Error(err.errMsg || '无法连接服务器，请检查地址和网络')); }
    });
  });
}
function uploadPhoto(goodId, filePath) {
  return new Promise((resolve, reject) => wx.uploadFile({
    url: `${baseUrl()}/api/media`, filePath, name: 'file', formData: { goodId },
    header: { Authorization: `Bearer ${token()}` },
    success(res) { const body = JSON.parse(res.data || '{}'); res.statusCode === 200 ? resolve(body) : reject(new Error(body.error || '上传失败')); },
    fail(err) { reject(new Error(err.errMsg || '上传失败')); }
  }));
}
function downloadPhoto(imageId) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url: `${baseUrl()}/api/media/${imageId}`,
    header: { Authorization: `Bearer ${token()}` },
    success(res) { res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('图片无权访问')); },
    fail(err) { reject(new Error(err.errMsg || '图片下载失败')); }
  }));
}
function scan() {
  return new Promise((resolve, reject) => wx.scanCode({
    onlyFromCamera: true, scanType: ['barCode', 'qrCode'],
    success(res) { resolve(String(res.result || '').trim()); }, fail: reject
  }));
}
module.exports = { KEY, URL_KEY, baseUrl, token, money, fail, ensureLogin, request, uploadPhoto, downloadPhoto, scan };
