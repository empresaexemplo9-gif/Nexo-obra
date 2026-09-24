// Worker do visualizador DXF: a leitura e a preparação do desenho saem da thread da tela,
// que continua respondendo enquanto uma planta grande carrega.
import { DxfViewer } from "dxf-viewer";

DxfViewer.SetupWorker();
