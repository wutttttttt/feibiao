'use client';

import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';

export default function CameraScanner({ onScan }: { onScan: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const accepted = useRef(false);
  const latestOnScan = useRef(onScan);
  latestOnScan.current = onScan;

  useEffect(() => {
    if (!open) return;
    let active = true;
    accepted.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前地址不能调用摄像头。请在本机使用 127.0.0.1，或通过 HTTPS 访问。');
      return;
    }
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (!active || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        const scanner = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          video.current,
          (result, _error, scanControls) => {
            const code = result?.getText().trim();
            if (!active || accepted.current || !code) return;
            accepted.current = true;
            scanControls.stop();
            latestOnScan.current(code);
            setOpen(false);
          },
        );
        if (active) controls.current = scanner;
        else scanner.stop();
      } catch (cause) {
        if (!active) return;
        const name = cause instanceof DOMException ? cause.name : '';
        setError(name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器地址栏允许摄像头。' :
          name === 'NotFoundError' ? '没有找到可用的摄像头。' : '摄像头启动失败，请检查设备权限后重试。');
      }
    })();
    return () => {
      active = false;
      controls.current?.stop();
      controls.current = null;
      const stream = video.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    };
  }, [open]);

  return <>
    <button className="softbutton scanner-trigger" type="button" onClick={() => { setError(''); setOpen(true); }}>📷 扫码</button>
    {open && <div className="scanner-backdrop" role="dialog" aria-modal="true" aria-label="摄像头扫码">
      <div className="scanner-panel">
        <h2>扫描货品标签</h2>
        <p>将条码放入画面中央，识别后会自动填入货号。</p>
        <video ref={video} muted playsInline aria-label="摄像头预览" />
        {error && <div className="error" role="alert">{error}</div>}
        <button className="softbutton" type="button" onClick={() => setOpen(false)}>关闭摄像头</button>
      </div>
    </div>}
  </>;
}
