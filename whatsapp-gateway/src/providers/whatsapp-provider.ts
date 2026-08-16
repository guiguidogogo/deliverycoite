export type ProviderStatus = { state: "connected" | "connecting" | "reconnecting" | "disconnected" | "qr_required" | "logged_out" | "error"; phone?: string; profileName?: string; profilePictureUrl?: string };

export interface WhatsAppProvider {
  createInstance(instanceName: string, webhookUrl: string): Promise<void>;
  getConnectionStatus(instanceName: string): Promise<ProviderStatus>;
  getQrCode(instanceName: string): Promise<{ code?: string; base64?: string }>;
  reconnect(instanceName: string): Promise<{ code?: string; base64?: string }>;
  sendText(instanceName: string, to: string, message: string): Promise<unknown>;
  sendImage(instanceName: string, to: string, imageUrl: string, caption?: string): Promise<unknown>;
  sendDocument(instanceName: string, to: string, documentUrl: string, filename: string, caption?: string): Promise<unknown>;
  logout(instanceName: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
}
