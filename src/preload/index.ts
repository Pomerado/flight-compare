import { contextBridge, ipcRenderer } from "electron";
import { exposePomerado } from "pomerado-app-kit/preload";

exposePomerado(contextBridge, ipcRenderer);
