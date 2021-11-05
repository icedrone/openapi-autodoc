import Head from "next/head";
import { ChangeEvent, useState } from "react";
import styles from "../styles/Home.module.css";
import YAML from "yaml";
import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPI } from "openapi-types";
import JSZip from "jszip";

function validateFileIsJsonOrYaml(file: File) {
  return file.name.endsWith(".json") || file.name.endsWith(".yaml");
}

function ab2str(buf: ArrayBuffer) {
  let decoder = new TextDecoder();
  return decoder.decode(buf);
}

interface GitBookFile {
  path: string;
  contents: string;
}

function createGitBookOpenAPITag(endpoint: Endpoint) {
  return `
{% swagger src="./.gitbook/assets/openapi.yaml" path="${endpoint.path}" method="${endpoint.operation}" %}
[openapi.yaml](<./.gitbook/assets/openapi.yaml>)
{% endswagger %}
  `;
}

function createTagPage(tag: TagObject, endpoints: Endpoint[]): GitBookFile {
  const path = `${tag.name}.md`;
  return {
    path,
    contents: `
# ${tag.name}

${tag.description}

${
  tag.externalDocs &&
  `[${tag.externalDocs.description}](${tag.externalDocs.url})`
}

${endpoints.map(createGitBookOpenAPITag).join("\n\n")}
  `.trim(),
  };
}

function createSummaryFile(gitBookFiles: GitBookFile[]): string {
  const summaryFile = `# Table of contents

${gitBookFiles
  .map(({ path, contents }: GitBookFile) => {
    return `[${path}](${path})`;
  })
  .join("\n")}`;
  console.log(summaryFile);
  return summaryFile;
}

function createReadmeFile(spec: OpenAPI.Document) {
  return `# ${spec.info.title}`;
}

async function createZipBundle(
  gitBookFiles: GitBookFile[],
  spec: string,
  parsedSpec: OpenAPI.Document
) {
  const bundle = new JSZip();
  bundle.file("SUMMARY.md", createSummaryFile(gitBookFiles));
  bundle.file("README.md", createReadmeFile(parsedSpec));
  gitBookFiles.forEach(({ path, contents }) => {
    bundle.file(path, contents);
  });
  const gitbookPrivateFolder = bundle.folder(".gitbook");
  gitbookPrivateFolder.file("openapi.yaml", spec);
  return await bundle.generateAsync({ type: "blob" });
}

interface Endpoint {
  operationObject: OperationObject;
  path: string;
  operation: string;
}

type TagObject = OpenAPI.Document["tags"][0];
type OperationsObject = OpenAPI.Document["paths"][string];
type OperationObject = OperationsObject["get"];

function makePagesForTagGroups(map: Map<TagObject, Endpoint[]>) {
  return Array.from(map.entries()).map(
    ([tag, endpoint]: [TagObject, Endpoint[]]) => {
      return createTagPage(tag, endpoint);
    }
  );
}

function collateTags(api: OpenAPI.Document) {
  const tagMap: Map<TagObject, Endpoint[]> = new Map();
  const untaggedTag: TagObject = { name: "__internal-untagged" };
  const operations = Object.entries(api.paths).flatMap(
    ([path, operations]: [string, OperationsObject]) => {
      return Object.entries(operations).map(
        ([operation, operationObject]: [string, OperationObject]) => {
          return { path, operation, operationObject };
        }
      );
    }
  );
  operations.forEach(({ path, operation, operationObject }) => {
    if (operationObject.tags.length === 0) {
      tagMap.set(untaggedTag, [
        ...(tagMap.get(untaggedTag) || []),
        { path, operation, operationObject },
      ]);
    }
    operationObject.tags.forEach((tagName) => {
      const tag: TagObject = api.tags.find(({ name }) => {
        return name === tagName;
      });
      tagMap.set(tag, [
        ...(tagMap.get(tag) || []),
        { path, operation, operationObject },
      ]);
    });
  });
  return tagMap;
}

export default function Home() {
  const [error, setError] = useState<string | undefined>();
  const [zipUrl, setZipUrl] = useState<string | undefined>();

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files[0];
    if (!validateFileIsJsonOrYaml(file)) {
      setError("File must be either JSON or YAML");
      return;
    }
    const filecontentsencoded = await file.arrayBuffer();
    const filecontentsdecoded = ab2str(filecontentsencoded);
    const apiObject = YAML.parse(filecontentsdecoded);
    let api = await SwaggerParser.validate(apiObject);
    let endpointsGroupedByTag = collateTags(api);
    console.log(endpointsGroupedByTag);
    let pages = makePagesForTagGroups(endpointsGroupedByTag);
    const bundle = await createZipBundle(pages, filecontentsdecoded, api);
    setZipUrl(URL.createObjectURL(bundle));
  }

  return (
    <div className={styles.container}>
      <Head>
        <title>GitBook OpenAPI Import</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>Upload your OpenAPI spec</h1>
        <p className={styles.description}>
          {error && <h3>{error}</h3>}
          <input type="file" onChange={handleFileUpload} />
          {zipUrl && <a href={zipUrl}>Download</a>}
        </p>
      </main>
    </div>
  );
}
