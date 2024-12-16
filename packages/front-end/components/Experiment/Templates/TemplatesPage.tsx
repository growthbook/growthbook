// {
//   false ? (
//     <Box>
//       <table className="appbox table experiment-table gbtable responsive-table">
//         <thead>
//           <tr>
//             <th></th>
//             <SortableTH field="name" className="w-100">
//               Template Name
//             </SortableTH>
//             <SortableTH field="tags">Description</SortableTH>
//             <SortableTH field="tags">Tags</SortableTH>
//             {showProjectColumn && (
//               <SortableTH field="projectName">Project</SortableTH>
//             )}
//             <SortableTH field="date">Created</SortableTH>
//             <SortableTH field="owner">Usage</SortableTH>
//           </tr>
//         </thead>
//         <tbody></tbody>
//       </table>
//     </Box>
//   ) : (
//     <div className="appbox p-5 text-center">
//       <h1>Create Reusable Experiment Templates</h1>
//       <Text size="3">
//         Save time configuring experiment details, and ensure consistency across
//         your team and projects.
//       </Text>
//       <div className="mt-3">
//         {/* Add docs button on left and render either Upgrade Plan or Create Template depending on plan */}
//         {!true ? (
//           <LinkButton href="/datasources">Connect Data Source</LinkButton>
//         ) : (
//           <Button onClick={() => setOpenNewExperimentModal(true)}>
//             Create Template
//           </Button>
//         )}
//       </div>
//     </div>
//   );
// }
