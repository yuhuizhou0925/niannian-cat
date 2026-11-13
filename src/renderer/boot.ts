import { loadCatModel } from './cat';

// 先把捏好的模型解析出来,再启动桌宠
loadCatModel().then(() => import('./main'));
