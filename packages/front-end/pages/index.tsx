import React from "react";
import Head from "next/head";
//import FeedbackLoop from "../components/HomePage/FeedbackLoop";
import Link from "next/link";
import { FaCheck } from "react-icons/fa";
import clsx from "clsx";
import Dashboard from "../components/HomePage/Dashboard";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";

export default function Home(): React.ReactElement {
  const { metrics, ready, datasources } = useDefinitions();

  const isNew = metrics.length < 1;

  return (
    <>
      <Head>
        <title>Growth Book</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {!ready && <LoadingOverlay />}

      {ready && isNew && (
        <div className="container p-5">
          <div className="text-center">
            <h1>Welcome to Growth Book!</h1>
            <p>
              There are two things you need to set up before you can start fully
              utilizing our platform
            </p>
          </div>
          <div className="list-group">
            <Link href="/settings/datasources">
              <a
                className={clsx("list-group-item list-group-item-action", {
                  "list-group-item-success": datasources.length > 0,
                })}
              >
                <div className="d-flex">
                  <div style={{ flex: 1 }}>
                    1. Connect to your Data Source{" "}
                    <span className="text-muted">(optional)</span>
                  </div>
                  {datasources.length > 0 && (
                    <div>
                      <FaCheck />
                    </div>
                  )}
                </div>
              </a>
            </Link>
            <Link href="/metrics">
              <a className="list-group-item list-group-item-action">
                2. Define your Key Metrics
              </a>
            </Link>
          </div>
        </div>
      )}

      {ready && !isNew && (
        <>
          <Dashboard />
        </>
      )}
    </>
  );
}
